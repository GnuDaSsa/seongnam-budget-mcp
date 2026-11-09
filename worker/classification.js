// Preserve explicit headings and the known expenditure-statement hierarchy.
// Unknown layouts remain partial; a page can contain several different paths.
export function budgetClassification(text,metadata={}){
 const lines=text.split('\n');
 const heading=label=>{const re=new RegExp('^\\s*'+label+'\\s*[:：]\\s*(.*?)(?:\\s{2,}|$)');for(const line of lines.slice(0,12)){const m=line.match(re);if(m)return m[1].trim();}return null;};
 const department=heading('부서'),policy_business=heading('정책');
 let unit_business=heading('단위'),detailed_business=null,appropriation=null;
 const header_unit_business=unit_business,paths=[];
 const recognized=!!department&&!!policy_business&&/부서[ㆍ·]정책[ㆍ·]단위\(회계\)[ㆍ·]세부사업[ㆍ·]편성목/.test(text.replaceAll(' ',''));
 if(recognized){
  for(let i=0;i<lines.length;i++){
   const line=lines[i],columns=line.trim().split(/\s{2,}/),label=columns[0];
   if(!columns.slice(1).some(x=>/^[△▲-]?\d[\d,]*(?:\.\d+)?$/.test(x.trim())))continue;
   const indent=line.length-line.trimStart().length;
   const account=label.match(/^(\d{3})\s+(.+)$/),stat=label.match(/^(\d{2})\s+(.+)$/);
   if(account){appropriation={code:account[1],name:account[2]};continue;}
   if(stat&&appropriation){paths.push({unit_business,detailed_business,appropriation:{...appropriation},statistical_item:{code:stat[1],name:stat[2]},source_line:i+1,source_excerpt:line.trim(),basis:'expenditure_statement_indentation'});continue;}
   if(!/^[가-힣]/.test(label)||/^[국도시]$/.test(label)||!label)continue;
   if(indent===2){unit_business=label;detailed_business=null;appropriation=null;}
   else if(indent===3){detailed_business=label;appropriation=null;}
   else if(indent<2){unit_business=null;detailed_business=null;appropriation=null;}
  }
 }
 return{status:paths.length?'layout_extracted':'partial',department,policy_business,header_unit_business,
  account:metadata.account&&metadata.account!=='원문 확인'?metadata.account:(metadata.title?.includes('일반회계')?'일반회계':null),
  paths:paths.slice(0,24),paths_truncated:paths.length>24,
  note:paths.length?'페이지에는 여러 사업 경로가 있습니다. 금액·산출기초와 해당 세부사업 경로를 대응시켜 인용하세요. 들여쓰기를 이용한 구조 추출이며 모호한 표는 원문 확인이 필요합니다.':'원문에서 확인되는 머리말만 표시했습니다. 세부사업·편성목·통계목은 미확인입니다. 코드나 상위 사업을 추정하지 마세요.'};
}
