import React from 'react'

type SlackText = { type: 'plain_text' | 'mrkdwn'; text: string }
type SlackBlock = { type: string; text?: SlackText; elements?: any[]; fields?: SlackText[]; image_url?: string; alt_text?: string; url?: string; title?: SlackText }

function renderMrkdwn(text: string) {
  // 아주 간단한 변환만: *bold* -> <strong>, 줄바꿈 유지
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*/g, '*')
  const html = safe
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>')
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

function Block({ block }: { block: SlackBlock }) {
  switch (block.type) {
    case 'header':
      return (
        <div style={{ fontWeight: 700, fontSize: 16, margin: '8px 0' }}>
          {(block.text?.type === 'plain_text') ? block.text.text : (block.text?.text || '')}
        </div>
      )
    case 'section':
      return (
        <div style={{ margin: '8px 0', lineHeight: 1.5 }}>
          {block.text?.type === 'mrkdwn' ? renderMrkdwn(block.text.text) : (block.text?.text || '')}
        </div>
      )
    case 'context':
      return (
        <div style={{ fontSize: 12, color: '#9aa4b2', margin: '6px 0' }}>
          {(block.elements || []).map((el: any, idx: number) => (
            <span key={idx} style={{ marginRight: 8 }}>
              {el.type === 'mrkdwn' ? renderMrkdwn(el.text || '') : (el.text || '')}
            </span>
          ))}
        </div>
      )
    case 'actions':
      return (
        <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
          {(block.elements || []).map((el: any, idx: number) => (
            <a key={idx} href={el.url} target="_blank" rel="noreferrer" style={{
              fontSize: 12,
              padding: '6px 10px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              textDecoration: 'none'
            }}>{el.text?.text || 'Open'}</a>
          ))}
        </div>
      )
    case 'divider':
      return <hr style={{ borderColor: 'var(--border)' }} />
    default:
      return null
  }
}

export default function SlackPreview({ blocks }: { blocks: SlackBlock[] }) {
  if (!blocks || blocks.length === 0) return <div className="muted">미리보기 블록이 없습니다.</div>
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
      {blocks.map((b, i) => <Block key={i} block={b as any} />)}
    </div>
  )
}

