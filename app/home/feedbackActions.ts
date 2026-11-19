'use server';

import { createAdminClient, isSupabaseConfigured } from '@/lib/supabase/server';

import {
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  type Feedback,
  type FeedbackKind,
  type FeedbackListResult,
  type FeedbackStatus,
} from '@/lib/feedback';

/** 홈 피드백 게시판(supabase/feedback_schema.sql 의 it_feedback) — 종류·상태 목록은 lib/feedback.ts */
const TABLE = 'it_feedback';

type Row = {
  id: string;
  kind: FeedbackKind;
  body: string;
  author: string;
  page: string;
  status: FeedbackStatus;
  reply: string;
  plus_count: number;
  created_at: string;
  updated_at: string;
};

const toFeedback = (r: Row): Feedback => ({
  id: r.id,
  kind: r.kind,
  body: r.body,
  author: r.author,
  page: r.page,
  status: r.status,
  reply: r.reply,
  plusCount: r.plus_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function isMissingTable(message: string, code?: string): boolean {
  return code === '42P01' || code === 'PGRST205' || /it_feedback/.test(message);
}

export async function listFeedback(): Promise<FeedbackListResult> {
  if (!isSupabaseConfigured()) return { ok: false, missingTable: false, error: 'Supabase 설정이 필요해요.' };
  const { data, error } = await createAdminClient().from(TABLE).select('*').order('created_at', { ascending: false }).limit(300);
  if (error) return { ok: false, missingTable: isMissingTable(error.message, error.code), error: error.message };
  return { ok: true, items: ((data ?? []) as Row[]).map(toFeedback) };
}

type Result = { ok: true; item: Feedback } | { ok: false; error: string };

export async function createFeedback(input: { kind: string; body: string; author: string; page: string }): Promise<Result> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: '내용을 적어 주세요.' };
  if (body.length > 2000) return { ok: false, error: '2000자까지 적을 수 있어요.' };
  const kind = (FEEDBACK_KINDS as readonly string[]).includes(input.kind) ? input.kind : '기타';
  const { data, error } = await createAdminClient()
    .from(TABLE)
    .insert({ kind, body, author: input.author.trim().slice(0, 30), page: input.page.trim().slice(0, 40) })
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, item: toFeedback(data as Row) };
}

export async function updateFeedback(id: string, patch: { status?: string; reply?: string }): Promise<Result> {
  const update: Record<string, string> = {};
  if (patch.status !== undefined) {
    if (!(FEEDBACK_STATUSES as readonly string[]).includes(patch.status)) return { ok: false, error: '알 수 없는 상태예요.' };
    update.status = patch.status;
  }
  if (patch.reply !== undefined) update.reply = patch.reply.trim().slice(0, 1000);
  const { data, error } = await createAdminClient().from(TABLE).update(update).eq('id', id).select('*').single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, item: toFeedback(data as Row) };
}

/** "나도 그래요" +1 — 동시에 눌러도 크게 문제 없는 숫자라 읽고 더해서 씀 */
export async function plusFeedback(id: string): Promise<Result> {
  const supabase = createAdminClient();
  const { data: cur, error: readErr } = await supabase.from(TABLE).select('plus_count').eq('id', id).single();
  if (readErr) return { ok: false, error: readErr.message };
  const { data, error } = await supabase
    .from(TABLE)
    .update({ plus_count: ((cur as { plus_count: number }).plus_count ?? 0) + 1 })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, item: toFeedback(data as Row) };
}
