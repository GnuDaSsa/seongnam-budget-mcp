import records from './verified-table-context.json' with {type:'json'};

// A record is reviewed against the original workbook, never inferred from
// another block or sheet. Ambiguous duplicate records fail closed.
export function lookupVerifiedTableContext(manifest,document,page,textHash){
 const matches=manifest.filter(r=>r.document_id===document?.id&&r.document_sha256===document?.sha256&&r.page===page&&r.text_sha256===textHash);
 return matches.length===1?matches[0].context:null;
}
export function verifiedTableContext(document,page,textHash){
 return lookupVerifiedTableContext(records,document,page,textHash);
}
