import { buildDeliveryFormTitle, type DeliveryConfirmForm } from '@/lib/deliveryConfirmForm';

/**
 * 정식 납품 확인서의 실제 문서 내용(화면 미리보기와 인쇄 둘 다 이 컴포넌트를 그대로 씀).
 * 원본 구글시트 개별 탭("대호건축1013" 등)의 섹션 구성을 재현합니다 — 병합 셀 대신
 * 테두리 박스 레이아웃으로.
 */

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', border: '1px solid #ccc', fontSize: '12.5px' }}>
      <div style={{ width: '96px', flexShrink: 0, padding: '6px 8px', background: '#f5f5f5', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ flex: 1, padding: '6px 8px' }}>{value || '-'}</div>
    </div>
  );
}

export default function DeliveryConfirmFormDocument({ form }: { form: DeliveryConfirmForm }) {
  return (
    <div style={{ width: '100%', maxWidth: '780px', margin: '0 auto', color: '#111', fontFamily: 'inherit' }}>
      <div style={{ textAlign: 'center', fontSize: '18px', fontWeight: 800, margin: '0 0 4px' }}>IT제품 납품 확인서</div>
      <div style={{ textAlign: 'center', fontSize: '12px', color: '#666', marginBottom: '14px' }}>
        {buildDeliveryFormTitle(form.company, form.deliveryDate)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '14px' }}>
        <Field label="상 호" value={form.company} />
        <Field label="부서/위치" value={form.department} />
        <Field label="발주일" value={form.orderDate} />
        <Field label="납품일" value={form.deliveryDate} />
        <Field label="유입구분" value={form.inflowType} />
        <Field label="업종" value={form.businessType} />
        <Field label="영업담당자" value={form.salesManager} />
        <Field label="요청담당자" value={form.requestManager} />
      </div>
      <div style={{ display: 'grid', gap: '4px', marginBottom: '14px' }}>
        <Field label="사업장주소" value={form.siteAddress} />
        <Field label="특이사항" value={form.specialNotes} />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', marginBottom: '14px' }}>
        <thead>
          <tr>
            {['품목', '임대료/단가', '수량'].map((h) => (
              <th key={h} style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 8px' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {form.items.map((item, i) => (
            <tr key={i}>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{item.model}</td>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{item.unitPrice || '-'}</td>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'center' }}>{item.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', marginBottom: '14px' }}>
        <Field label="계약기간" value={form.contractPeriod} />
        <Field label="보증금" value={form.deposit} />
        <Field label="결제 특이사항" value={form.paymentNotes} />
      </div>
      <div style={{ marginBottom: '18px' }}>
        <Field label="소모품" value={form.consumables} />
      </div>

      <div style={{ fontWeight: 800, fontSize: '13px', margin: '0 0 8px', borderTop: '2px solid #111', paddingTop: '10px' }}>
        [ 출고 장비 목록 ]
      </div>
      {form.items.map((item, i) => (
        <table key={i} style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', marginBottom: '10px' }}>
          <tbody>
            <tr>
              <td style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 8px', width: '96px', fontWeight: 700 }}>구분</td>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{item.category}</td>
              <td style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 8px', width: '96px', fontWeight: 700 }}>품목</td>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{item.model}</td>
            </tr>
            <tr>
              <td style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 8px', fontWeight: 700 }}>수량</td>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{item.quantity}</td>
              <td style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 8px', fontWeight: 700 }}>제조사</td>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{item.manufacturer || '-'}</td>
            </tr>
            <tr>
              <td style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 8px', fontWeight: 700 }}>자산번호</td>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px', whiteSpace: 'pre-line' }}>
                {item.units.map((u) => u.assetId || '-').join('\n')}
              </td>
              <td style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 8px', fontWeight: 700 }}>S/N</td>
              <td style={{ border: '1px solid #ccc', padding: '6px 8px', whiteSpace: 'pre-line' }}>
                {item.units.map((u) => u.serialNumber || '-').join('\n')}
              </td>
            </tr>
            <tr>
              <td style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 8px', fontWeight: 700 }}>하드웨어스펙</td>
              <td colSpan={3} style={{ border: '1px solid #ccc', padding: '6px 8px', whiteSpace: 'pre-line' }}>
                {item.hardwareSpec || '-'}
              </td>
            </tr>
          </tbody>
        </table>
      ))}
    </div>
  );
}
