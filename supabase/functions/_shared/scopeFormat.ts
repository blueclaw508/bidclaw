export const SCOPE_FORMAT_RULES = `SCOPE FORMAT: Both scope_description (crew/internal) and client_scope_description MUST be bullet lists, each bullet on its own line starting "- ". No introductory paragraph or run-on paragraph. Client scope: usually 3–6 short bullets in simple language covering the finished work, headline size/material choice and important exclusions. Omit crew instructions, rates, hours and purchasing detail. Crew scope: separate ordered steps expressed as bullets, with confirmed construction details, quantities, sequencing and exclusions. Keep assumptions separate from promised work. The client list must be simpler than the crew list without changing the agreed scope.`

/** Format new generated text only. Preserve all facts; never rewrite saved scopes. */
export function bulletScope(value:string | null | undefined):string {
  if(!value?.trim()) return ''
  const paragraphs=value.replace(/\r/g,'').split(/\n+/).filter(s=>s.trim())
  return paragraphs.flatMap(line=>{
    const clean=line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/,'')
    // Preserve decimals and abbreviations by using sentence segmentation.
    return [...new Intl.Segmenter('en',{granularity:'sentence'}).segment(clean)].map(s=>'- '+s.segment.trim()).filter(s=>s!=='- ')
  }).join('\n')
}
