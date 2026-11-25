import test from 'node:test';
import assert from 'node:assert/strict';
import broker from '../../../broker-import.js';
const convert=(csv,options={},mapping)=>{const table=broker.parse(csv);return broker.convert(table,mapping||broker.suggest(table.headers),options);};

test('maps broker headers and explicit Buy/Sell position direction',()=>{
  const [row]=convert('Trade Date,Trading Symbol,Side,Average Entry Price,Close Price,Quantity,Gross Pnl,Commission,Account Currency\n04/11/2026,AAPL,BUY,100,105,2,10,1,USD', {dateFormat:'dmy',sideMode:'buy-sell',currency:'USD',brokerName:'Global Broker'});
  assert.equal(row.date,'2026-11-04');assert.equal(row.symbol,'AAPL');assert.equal(row.direction,'Long');assert.equal(row.entry,100);assert.equal(row.qty,2);assert.equal(row.pnl,10);assert.equal(row.fee,1);assert.equal(row.tags,'Broker: Global Broker');assert.equal(row.currency,undefined);
});
test('parses semicolon exports with decimal commas and accounting losses',()=>{
  const [row]=convert('Date;Instrument;Direction;Gross Profit;Commission\n04.11.2026;EURUSD;Short;(1.234,50);(1,25)',{dateFormat:'dmy',decimal:'comma',absoluteFees:true});
  assert.equal(row.pnl,-1234.5);assert.equal(row.fee,1.25);
});
test('net P&L is converted to gross exactly once so fees stay accurate',()=>{
  const table=broker.parse('Date,Ticker,Direction,Net Profit,Fees\n2026-11-04,SPY,Long,100,-5');const mapping=broker.suggest(table.headers);mapping.pnl=3;
  const [row]=broker.convert(table,mapping,{pnlBasis:'net',absoluteFees:true});assert.equal(row.pnl,105);assert.equal(row.pnl-row.fee,100);
});
test('does not silently interpret execution sides or ambiguous dates',()=>{
  assert.throws(()=>convert('date,symbol,direction\n2026-11-04,AAPL,SELL'),/explicitly select Buy\/Sell/);
  assert.throws(()=>convert('date,symbol,direction\n04\/11\/2026,AAPL,Long'),/date format/);
  assert.equal(convert('date,symbol,direction\n11\/04\/2026,AAPL,Long',{dateFormat:'mdy'})[0].date,'2026-11-04');
});
test('rejects invalid calendar dates and currency mismatches',()=>{
  assert.throws(()=>convert('date,symbol,direction\n2026-02-30,AAPL,Long'),/Invalid date/);
  assert.throws(()=>convert('date,symbol,direction,currency\n2026-11-04,AAPL,Long,INR',{currency:'USD'}),/currency does not match/);
});
test('requires explicit decimal format instead of changing monetary values',()=>{
  assert.throws(()=>convert('date;symbol;direction;pnl\n2026-11-04;AAPL;Long;12,50'),/decimal separator/);
  assert.equal(convert('date;symbol;direction;pnl\n2026-11-04;AAPL;Long;12,50',{decimal:'comma'})[0].pnl,12.5);
});
test('preserves quoted multiline notes, BOM and tab-separated exports',()=>{
  const [row]=convert('\uFEFFdate\tsymbol\tdirection\tnotes\n2026-11-04\tAAPL\tLong\t"First line\nsaid ""hello"""');assert.equal(row.notes,'First line\nsaid "hello"');
});
test('rejects malformed, oversized and ambiguously mapped files',()=>{
  assert.throws(()=>broker.parse('date,symbol,symbol\n2026-11-04,AAPL,AAPL'),/unique/);
  assert.throws(()=>broker.parse('date,symbol\n2026-11-04,AAPL,Long'),/more values/);
  assert.throws(()=>broker.parse('date,symbol,direction\n'+Array(1001).fill('2026-11-04,AAPL,Long').join('\n')),/1,000/);
  const table=broker.parse('date,symbol,direction\n2026-11-04,AAPL,Long');const mapping=broker.suggest(table.headers);mapping.broker=mapping.symbol;assert.throws(()=>broker.convert(table,mapping),/only one journal field/);
});
test('supports fractional and signed trade amounts, rejecting non-finite values',()=>{
  const [row]=convert('date,symbol,direction,entry,qty,pnl\n2026-11-04,SPY,Long,.5,0.25,-2.5');assert.equal(row.entry,.5);assert.equal(row.qty,.25);assert.equal(row.pnl,-2.5);
  assert.throws(()=>convert('date,symbol,direction,pnl\n2026-11-04,SPY,Long,NaN'),/Invalid pnl/);
});


test('forex calculations need explicit units and the preview uses the same multiplier',()=>{
 const csv='Date,Symbol,Direction,Entry,Exit,Qty\n2026-11-05,EURUSD,Long,1.1,1.101,1';
 assert.throws(()=>convert(csv),/contract multiplier/);
 const [row]=convert(csv,{contractValue:'100000'});assert.ok(Math.abs(row.pnl-100)<1e-8);
});
test('unique closed-trade IDs retain their broker namespace',()=>{
 const csv='Date,Symbol,Direction,Pnl,Trade ID\n2026-11-05,SPY,Long,10,broker-123';
 assert.throws(()=>convert(csv),/broker/);
 const [row]=convert(csv,{brokerName:'Example'});assert.equal(row.execution_id,'broker-123');assert.equal(row.broker_key,'Example');
});

import {deflateRawSync} from 'node:zlib';
// Minimal zip writer for test workbooks (CRC is not checked by the reader).
function zip(files){
  const locals=[],central=[];let offset=0;
  for(const [name,text] of Object.entries(files)){
    const n=Buffer.from(name),data=deflateRawSync(Buffer.isBuffer(text)?text:Buffer.from(text));
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(8,8);local.writeUInt32LE(data.length,18);local.writeUInt16LE(n.length,26);
    const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50,0);dir.writeUInt16LE(8,10);dir.writeUInt32LE(data.length,20);dir.writeUInt16LE(n.length,28);dir.writeUInt32LE(offset,42);
    locals.push(local,n,data);central.push(dir,n);offset+=30+n.length+data.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  const out=Buffer.concat([...locals,cd,end]);return out.buffer.slice(out.byteOffset,out.byteOffset+out.length);
}
const blob=buffer=>({arrayBuffer:async()=>buffer});

test('reads plain XML trade records from elements and attributes',()=>{
  const table=broker.parseFile(`<?xml version="1.0"?><!-- export --><Report><Trades><Trade id="T1"><Date>2026-11-04</Date><Symbol>AT&amp;T</Symbol><Side>Long</Side><Pnl>12.5</Pnl></Trade><Trade id="T2"><Date>2026-11-05</Date><Symbol><![CDATA[EURUSD]]></Symbol><Side>Short</Side><Pnl>-3</Pnl></Trade></Trades></Report>`);
  assert.deepEqual(table.headers,['id','Date','Symbol','Side','Pnl']);
  const rows=broker.convert(table,broker.suggest(table.headers));
  assert.equal(rows.length,2);assert.equal(rows[0].symbol,'AT&T');assert.equal(rows[1].symbol,'EURUSD');assert.equal(rows[1].direction,'Short');assert.equal(rows[1].pnl,-3);
});
test('reads Excel XML Spreadsheet 2003 including skipped cells',()=>{
  const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Trades"><Table><Row><Cell><Data ss:Type="String">Date</Data></Cell><Cell><Data ss:Type="String">Symbol</Data></Cell><Cell><Data ss:Type="String">Direction</Data></Cell><Cell><Data ss:Type="String">Pnl</Data></Cell></Row><Row><Cell><Data ss:Type="String">2026-11-04</Data></Cell><Cell><Data ss:Type="String">AAPL</Data></Cell><Cell ss:Index="4"><Data ss:Type="Number">7</Data></Cell></Row></Table></Worksheet></Workbook>`;
  const table=broker.parseFile(xml);assert.deepEqual(table.records[0],['2026-11-04','AAPL','','7']);
});
test('rejects broken XML with a clear message',()=>{
  assert.throws(()=>broker.parseFile('<Trades><Trade><Date>1</Trade></Trades>'),/does not match/);
  assert.throws(()=>broker.parseFile('<Trades><Trade><Date>1</Date>'),/ends before/);
});
test('pads short CSV rows but rejects rows with extra values',()=>{
  assert.deepEqual(broker.parse('date,symbol,direction\n2026-11-04,AAPL\n').records[0],['2026-11-04','AAPL','']);
  assert.throws(()=>broker.parse('date,symbol\n2026-11-04,AAPL,Long'),/more values/);
});
test('reads .xlsx workbooks with shared strings and date cells',async()=>{
  const buffer=zip({
    'xl/workbook.xml':'<workbook xmlns:r="r"><sheets><sheet name="Trades" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/trades.xml"/></Relationships>',
    'xl/sharedStrings.xml':'<sst><si><t>Date</t></si><si><t>Symbol</t></si><si><r><t>Dir</t></r><r><t>ection</t></r></si><si><t>Net P&amp;L</t></si><si><t>BTCUSD</t></si><si><t>Long</t></si></sst>',
    'xl/styles.xml':'<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    'xl/worksheets/trades.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" s="1"><v>46330.5</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c><c r="D2"><v>125.5</v></c></row></sheetData></worksheet>',
  });
  const table=await broker.parseUpload(blob(buffer));
  assert.deepEqual(table.headers,['Date','Symbol','Direction','Net P&L']);
  assert.deepEqual(table.records[0],['2026-11-04 12:00:00','BTCUSD','Long','125.5']);
  const [row]=broker.convert(table,broker.suggest(table.headers));assert.equal(row.date,'2026-11-04');assert.equal(row.symbol,'BTCUSD');
});
test('explains that old .xls files must be saved as .xlsx or CSV',async()=>{
  await assert.rejects(broker.parseUpload(blob(new Uint8Array([0xd0,0xcf,0x11,0xe0,0,0]).buffer)),/Old \.xls/);
});
test('reads MetaTrader style .xlsx: UTF-16 parts, title rows and several tables',async()=>{
  const u16=s=>Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(s,'utf16le')]).toString('latin1');
  const cell=(r,c,v)=>`<c r="${'ABCDEFGHIJKLM'[c]}${r}" t="inlineStr"><is><t>${v}</t></is></c>`;
  const row=(r,vals)=>`<row r="${r}">${vals.map((v,c)=>v===''?'':cell(r,c,v)).join('')}</row>`;
  const sheet='<?xml version="1.0" encoding="UTF-16"?><worksheet><sheetData>'+[
    ['Trade History Report'],['Name:','','','Someone'],['Company:','','','Demo Broker Ltd.'],['Positions'],
    ['Time','Position','Symbol','Type','Volume','Price','S / L','T / P','Time','Price','Commission','Swap','Profit'],
    ['2026.11.25 17:15:02','17220580','XAUUSD','sell','0.01','3460.35','3459.81','3450.20','2026.11.25 17:15:55','3452.56','0.00','0.00','7.79'],
    ['Deals'],['Time','Deal','Symbol','Type','Direction','Volume','Price','Order','Commission','Fee','Swap','Profit','Balance'],
    ['2026.11.25 17:15:02','1','XAUUSD','sell','in','0.01','3460.35','17220580','0','0','0','0','100'],
  ].map((v,i)=>row(i+1,v)).join('')+'</sheetData></worksheet>';
  // Write parts as latin1 so the UTF-16 bytes survive the zip helper unchanged.
  const files={'xl/workbook.xml':'<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'};
  const raw={'xl/worksheets/sheet1.xml':u16(sheet)};
  const buffer=zip(Object.fromEntries([...Object.entries(files),...Object.entries(raw)].map(([k,v])=>[k,k in raw?Buffer.from(v,'latin1'):v])));
  const table=await broker.parseUpload(blob(buffer));
  assert.deepEqual(table.headers.slice(0,4),['Open Time','Position ID','Symbol','Side']);assert.equal(table.records.length,1);assert.equal(table.broker,'Demo Broker Ltd.');
  const mapping=broker.suggest(table.headers);assert.equal(broker.sideHint(table,mapping),'buy-sell');
  const [trade]=broker.convert(table,mapping,{sideMode:'buy-sell',brokerName:'MT5'});
  assert.equal(trade.date,'2026-11-25');assert.equal(trade.direction,'Short');assert.equal(trade.entry,3460.35);assert.equal(trade.exit,3452.56);assert.equal(trade.pnl,7.79);assert.equal(trade.execution_id,'17220580');
});
