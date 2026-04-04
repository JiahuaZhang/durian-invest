import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { buildOptionChainArgs, buildStrikeRows, parseBatchResponse, qsBatchLoad } from './client'
import type { QSChainResult } from './types'

// ── Fetch option chain via BatchLoadCommand ─────────────────────────────────

export const fetchQSChain = createServerFn({ method: 'POST' })
    .inputValidator((input: {
        cookies: string
        optionSeries: string
        numStrikes?: number
        pid?: number
        pf?: number
    }) => z.object({
        cookies:      z.string().min(1),
        optionSeries: z.string().min(2).max(20),
        numStrikes:   z.number().optional().default(12),
        pid:          z.number().optional().default(40),
        pf:           z.number().optional().default(6),
    }).parse(input))
    .handler(async ({ data: { cookies, optionSeries, numStrikes, pid, pf } }) => {
        const args = buildOptionChainArgs(optionSeries, numStrikes)
        const res = await qsBatchLoad(cookies, args, pf, pid)

        if (res.status === 302 || res.status === 401 || res.status === 403) {
            throw new Error(
                `QuikStrike rejected the session (HTTP ${res.status}). ` +
                'Your cookies may have expired — re-copy them from Chrome.',
            )
        }

        if (res.status !== 200) {
            throw new Error(
                `QuikStrike returned HTTP ${res.status}. ` +
                `Preview: ${res.body.slice(0, 300)}`,
            )
        }

        if (!res.data) {
            throw new Error(
                'QuikStrike returned a non-JSON response. ' +
                `Preview: ${res.body.slice(0, 300)}`,
            )
        }

        const parsed = parseBatchResponse(res.data)

        if (parsed.errorMessage) {
            throw new Error(
                `QuikStrike error: ${parsed.errorMessage}\n` +
                'Your cookies may have expired. Re-copy them from Chrome DevTools.',
            )
        }

        if (parsed.legs.length === 0) {
            const preview = JSON.stringify(res.data).slice(0, 500)
            throw new Error(
                'QuikStrike returned data but no option legs could be parsed.\n' +
                'The option series code may be invalid. ' +
                `Try a code like "${optionSeries.slice(0, -1)}K6" or check QuikStrike for valid expiries.\n\n` +
                `Response preview: ${preview}`,
            )
        }

        const strikes = buildStrikeRows(parsed.legs)

        return {
            product: optionSeries,
            expiry: optionSeries,
            futuresCode: parsed.futuresSymbol,
            futuresPrice: parsed.futuresPrice,
            futuresChange: parsed.futuresChange,
            dte: Math.round(parsed.dte * 100) / 100,
            putVolume: 0,
            callVolume: 0,
            iv: parsed.atmIV,
            ivChange: 0,
            strikes,
            fetchedAt: new Date().toISOString(),
            _endpoint: 'POST /AjaxPages/QuikScript.aspx/BatchLoadCommand',
            _raw: res.data,
        } satisfies QSChainResult
    })
