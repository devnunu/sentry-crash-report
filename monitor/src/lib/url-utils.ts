import {headers} from 'next/headers'

/**
 * 현재 요청의 호스트 정보를 기반으로 베이스 URL을 동적으로 생성합니다.
 * Vercel, Netlify, 로컬 환경 등에서 자동으로 올바른 URL을 감지합니다.
 */
export function getBaseUrl(): string {
  try {
    // Server-side에서 실행 중인 경우 headers에서 host 정보 가져오기
    const headersList = headers()
    const host = headersList.get('host')
    const protocol = headersList.get('x-forwarded-proto') || 'https'

    if (host) {
      return `${protocol}://${host}`
    }
  } catch (error) {
    // headers() 호출이 실패한 경우 (클라이언트 사이드이거나 static 생성 중)
    console.log('Failed to get headers, falling back to environment variables')
  }

  // Fallback 1: 명시적으로 설정된 BASE_URL
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL
  }

  // Fallback 2: Vercel 환경변수
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }

  // Fallback 3: 로컬 개발 환경
  return 'http://localhost:3000'
}

/**
 * 플랫폼별 일간 리포트 페이지 URL을 생성합니다.
 */
export function buildDailyReportUrl(platform: string, date: string): string {
  const baseUrl = getBaseUrl()
  return `${baseUrl}/monitor/daily/${platform}?date=${date}`
}

