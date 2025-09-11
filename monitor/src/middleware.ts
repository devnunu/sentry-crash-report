import { NextRequest, NextResponse } from 'next/server'

export function middleware(_request: NextRequest) {
  // 로컬 dev-cron 초기화는 제거. 단순 패스스루.
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
