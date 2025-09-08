import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  // 개발 환경에서만 실행
  if (process.env.NODE_ENV === 'development') {
    // API 요청에 대해서만 cron 초기화
    if (request.nextUrl.pathname.startsWith('/api/')) {
      // 헤더에 개발 서비스 초기화 신호 추가
      const response = NextResponse.next()
      response.headers.set('x-dev-init', 'true')
      return response
    }
  }
  
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}