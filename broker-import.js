(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.TradeDeskBrokerImport=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const fields=['date','symbol','direction','setup','entry','stop','exit','qty','pnl','fee','risk','r_multiple','notes','tags','contract_value','broker','currency','execution_id'];
  const numeric=new Set(['entry','stop','exit','qty','pnl','fee','risk','r_multiple','contract_value']);
  const aliases={execution_id:['tradeid','positionid','brokertradeid','closedtradeid'],date:['date','tradedate','opendate','entrydate','entrytime','datetime','time'],symbol:['symbol','tradingsymbol','ticker','instrument','contract','product'],direction:['direction','side','position','positionside','buysell'],entry:['entry','entryprice','openprice','averageentryprice','buyprice'],exit:['exit','exitprice','closeprice','averageexitprice','sellprice'],stop:['stop','stoploss','sl'],qty:['qty','quantity','size','volume','lots'],pnl:['pnl','grosspnl','grossprofit','profitloss','realizedpnl','realisedpnl'],fee:['fee','fees','commission','commissions','brokerage'],contract_value:['contractvalue','contractmultiplier','multiplier'],broker:['broker','brokername','exchange'],currency:['currency','accountcurrency','pnlcurrency','profitcurrency'],r_multiple:['rmultiple','r'],setup:['setup','strategy'],risk:['risk'],notes:['notes','comment','comments','description'],tags:['tags']};
  const normalize=value=>String(value).trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  function parse(text){
    const source=String(text).replace(/^\uFEFF/,'');
    // Detect the separator from the header, excluding delimiters inside quotes.
    const counts={',':0,';':0,'\t':0};let quoted=false;
    for(let i=0;i<source.length;i++){const c=source[i];if(c==='"'){if(quoted&&source[i+1]==='"'){i++;continue;}quoted=!quoted;}else if(!quoted){if(c==='\n'||c==='\r')break;if(c in counts)counts[c]++;}}
    const delimiter=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
    const records=[];let record=[],value='',inQuote=false;
    for(let i=0;i<source.length;i++){
      const c=source[i];
      if(inQuote){if(c==='"'&&source[i+1]==='"'){value+='"';i++;}else if(c==='"')inQuote=false;else value+=c;}
      else if(c==='"'&&value==='')inQuote=true;
      else if(c===delimiter){record.push(value);value='';}
      else if(c==='\n'||c==='\r'){if(c==='\r'&&source[i+1]==='\n')i++;record.push(value);if(record.some(v=>v.trim()))records.push(record);record=[];value='';}
      else value+=c;
    }
    if(inQuote)throw Error('CSV has an unclosed quote.');
    record.push(value);if(record.some(v=>v.trim()))records.push(record);
    if(records.length<2)throw Error('Add a header row and at least one trade.');
    const headers=records.shift().map(v=>v.trim());
    if(headers.some(v=>!v)||new Set(headers.map(v=>v.toLowerCase())).size!==headers.length)throw Error('Use unique, non-empty CSV column headers.');
    if(records.length>1000)throw Error('Import up to 1,000 trades at a time.');
    records.forEach((row,i)=>{if(row.length!==headers.length)throw Error('Column count differs on data row '+(i+1));});
    return{headers,records};
  }
  function suggest(headers){
    const normalized=headers.map(normalize);
    return Object.fromEntries(fields.map(field=>[field,normalized.findIndex(value=>(aliases[field]||[normalize(field)]).includes(value))]));
  }
  function dateValue(raw,format){
    const value=String(raw).trim();let year,month,day;
    if(/^\d{4}-\d{2}-\d{2}(?:$|[ T])/.test(value)){[year,month,day]=value.slice(0,10).split('-').map(Number);}
    else{
      const parts=value.split(/[ T]/)[0].split(/[/.\-]/);
      if(parts.length!==3||parts.some(p=>!/^\d+$/.test(p)))throw Error('Choose the date format used in your file.');
      if(format==='dmy'){[day,month,year]=parts.map(Number);}else if(format==='mdy'){[month,day,year]=parts.map(Number);}else{[year,month,day]=parts.map(Number);}
    }
    const date=new Date(Date.UTC(year,month-1,day));
    if(year<1900||year>2200||date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day)throw Error('Invalid date. Check the selected date format.');
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  function numberValue(raw,decimal,field){
    let value=String(raw??'').trim();if(!value)return null;
    value=value.replace(/^(?:USD|INR)\s*/i,'').replace(/[₹$\s]/g,'');
    if(/^\(.*\)$/.test(value))value='-'+value.slice(1,-1);
    if(value[0]==='+')value=value.slice(1);
    const separator=decimal==='comma'?',':'.';if(value.startsWith(separator))value='0'+value;else if(value.startsWith('-'+separator))value='-0'+value.slice(1);
    const pattern=decimal==='comma'?/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/:/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
    if(!pattern.test(value))throw Error('Invalid '+field+'. Check the decimal separator.');
    const result=Number(decimal==='comma'?value.replace(/\./g,'').replace(',','.'):value.replace(/,/g,''));
    if(!Number.isFinite(result)||Math.abs(result)>1e12||(!['pnl','r_multiple'].includes(field)&&result<0)||(field==='contract_value'&&result<=0))throw Error('Invalid '+field+'.');
    return result;
  }
  function convert(table,mapping,options={}){
    const used=fields.filter(field=>Number(mapping[field])>=0).map(field=>Number(mapping[field]));
    if(new Set(used).size!==used.length)throw Error('Map each CSV column to only one journal field.');
    for(const key of ['date','symbol','direction'])if(!Number.isInteger(Number(mapping[key]))||Number(mapping[key])<0||Number(mapping[key])>=table.headers.length)throw Error('Map the '+key+' column first.');
    return table.records.map((record,index)=>{
      try{
        const row={};
        for(const field of fields){const column=Number(mapping[field]);if(!Number.isInteger(column)||column<0||column>=record.length)continue;const value=String(record[column]??'').trim();row[field]=numeric.has(field)?numberValue(value,options.decimal,field==='fee'&&options.absoluteFees?'pnl':field):value;}
        row.date=dateValue(row.date,options.dateFormat||'ymd');
        if(!row.symbol)throw Error('A symbol is required.');
        const direction=String(row.direction).toLowerCase();
        if(['long','short'].includes(direction))row.direction=direction==='long'?'Long':'Short';
        else if(options.sideMode==='buy-sell'&&['buy','sell','b','s'].includes(direction))row.direction=['buy','b'].includes(direction)?'Long':'Short';
        else throw Error('Use Long/Short positions, or explicitly select Buy/Sell direction mapping.');
        if(options.absoluteFees&&row.fee!=null)row.fee=Math.abs(row.fee);
        if(options.pnlBasis==='net'&&row.pnl!=null)row.pnl+=row.fee||0;
        if(row.currency&&options.currency&&row.currency.toUpperCase()!==options.currency)throw Error('P&L currency does not match the journal currency. Convert amounts before importing.');
        delete row.currency;
        if(row.contract_value==null&&options.contractValue)row.contract_value=numberValue(options.contractValue,options.decimal,'contract_value');
        if(row.pnl==null&&[row.entry,row.exit,row.qty].every(value=>value!=null)){
          if(row.contract_value==null)throw Error('Map a contract multiplier, set units per lot, or provide broker P&L.');
          row.pnl=(row.exit-row.entry)*row.qty*row.contract_value*(row.direction==='Short'?-1:1);
        }
        const broker=(row.broker||options.brokerName||'').trim();delete row.broker;
        if(row.execution_id&&!broker)throw Error('Choose the broker for these trade IDs.');
        if(row.execution_id)row.broker_key=broker;
        if(broker)row.tags=[row.tags,'Broker: '+broker].filter(Boolean).join(', ');
        return row;
      }catch(error){throw Error('Row '+(index+1)+': '+error.message);}
    });
  }
  return{fields,parse,suggest,convert};
});
