export function safeCliError(error) {
  const firstLine=value=>String(value??'').split('\n',1)[0].replace(/0x[0-9a-fA-F]{12,}/g,'[REDACTED_HEX]');
  const summary=firstLine(error?.shortMessage||error?.message||'Unknown error');
  const detail=firstLine(error?.details);
  return detail&&detail!==summary?`${summary} ${detail}`:summary;
}
