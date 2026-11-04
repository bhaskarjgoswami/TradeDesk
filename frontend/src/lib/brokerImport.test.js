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
  assert.throws(()=>broker.parse('date,symbol,direction\n2026-11-04,AAPL'),/Column count/);
  assert.throws(()=>broker.parse('date,symbol,direction\n'+Array(1001).fill('2026-11-04,AAPL,Long').join('\n')),/1,000/);
  const table=broker.parse('date,symbol,direction\n2026-11-04,AAPL,Long');const mapping=broker.suggest(table.headers);mapping.broker=mapping.symbol;assert.throws(()=>broker.convert(table,mapping),/only one journal field/);
});
test('supports fractional and signed trade amounts, rejecting non-finite values',()=>{
  const [row]=convert('date,symbol,direction,entry,qty,pnl\n2026-11-04,SPY,Long,.5,0.25,-2.5');assert.equal(row.entry,.5);assert.equal(row.qty,.25);assert.equal(row.pnl,-2.5);
  assert.throws(()=>convert('date,symbol,direction,pnl\n2026-11-04,SPY,Long,NaN'),/Invalid pnl/);
});
