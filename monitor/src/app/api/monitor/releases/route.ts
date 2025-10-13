import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createApiError, createApiResponse, getErrorMessage } from '@/lib/utils'
import { SentryService } from '@/lib/sentry'

const querySchema = z.object({
  platform: z.enum(['android', 'ios']).default('android'),
  baseRelease: z.string().min(1, '베이스 버전을 입력해주세요')
})

export async function GET(request: NextRequest) {
  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries())
    const { platform, baseRelease } = querySchema.parse(searchParams)

    const sentryService = new SentryService(platform)
    const releases = await sentryService.searchReleaseCandidates(baseRelease.trim())

    return NextResponse.json(createApiResponse({
      releases: releases.map(release => ({
        version: release.version,
        dateReleased: release.dateReleased,
        dateCreated: release.dateCreated,
        environments: release.environments,
        projectMatched: release.projectMatched,
        environmentMatched: release.environmentMatched
      }))
    }))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        createApiError(error.issues.map(issue => issue.message).join(', ')),
        { status: 400 }
      )
    }

    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}
