import Shell from '@/components/Shell';
import SecretSetupTool from '@/components/contracts/SecretSetupTool';
import { secretsConfigDetail } from '@/lib/contracts/secrets';

// 환경변수가 들어갔는지 매번 확인(값은 화면에 안 보냄 — 있음/없음만)
export const dynamic = 'force-dynamic';

/** 계약 관리 비밀 칸 설정(메뉴엔 없음 — "설정 전" 안내에서 링크). 열쇠·비밀번호 해시는 브라우저 안에서만 만듦 */
export default function ContractSecretSetupPage() {
  const status = secretsConfigDetail();
  return (
    <Shell activeMenu="계약 관리" title="🔐 계약 관리 · 비밀 칸 설정" note="암호화 열쇠와 인증 비밀번호 만들기 — 계산은 이 브라우저 안에서만">
      <SecretSetupTool keyConfigured={status.key} hashConfigured={status.passwordHash} />
    </Shell>
  );
}
