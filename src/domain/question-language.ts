import type { Question } from './schema';

/** 英語題內容使用英文；其他科目沿用頁面的中文語言與字型。 */
export function questionLanguage(subject: Question['subject']): 'en' | undefined {
  return subject === '英語' ? 'en' : undefined;
}
