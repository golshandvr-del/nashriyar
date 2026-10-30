// Comment pre-flagging (ROADMAP phase 6). This is ONLY a hint for human moderators: a flagged comment
// still goes to the normal pending queue and the final decision is always made by the team.
import { normalizeFa } from '../../shared/fa'

// Deliberately short, conservative list of clearly abusive Persian/English terms (normalized form).
// Matching is done on whole words after normalization so ordinary words are not caught by substrings.
const BAD_WORDS = [
  'احمق', 'کثافت', 'بیشعور', 'بی شعور', 'خفه شو', 'گمشو', 'لعنتی', 'آشغال', 'اشغال', 'حرومزاده', 'حرامزاده',
  'کصافت', 'جنده', 'کونی', 'کیری', 'کسکش', 'مادرجنده', 'پدرسوخته', 'الاغ', 'گاو', 'خر',
  'idiot', 'stupid', 'fuck', 'shit', 'bitch', 'asshole'
].map(normalizeFa)

const LINK_RE = /(https?:\/\/|www\.|t\.me\/|@\w{4,})/i
const REPEAT_RE = /(.)\1{7,}/ // "!!!!!!!!" or "خخخخخخخخ"

export interface FlagResult {
  flagged: boolean
  reasons: string[]
}

/** Returns whether a user comment should be pre-flagged for moderators, and why. */
export function flagComment(text: string): FlagResult {
  const reasons: string[] = []
  const norm = ` ${normalizeFa(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `
  if (BAD_WORDS.some((w) => norm.includes(` ${w} `))) reasons.push('profanity')
  if (LINK_RE.test(text)) reasons.push('link')
  if (REPEAT_RE.test(text)) reasons.push('repetition')
  const letters = text.replace(/[^A-Za-z]/g, '')
  if (letters.length >= 12 && letters === letters.toUpperCase()) reasons.push('shouting')
  return { flagged: reasons.length > 0, reasons }
}
