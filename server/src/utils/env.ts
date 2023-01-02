
// Utility functions for handling environment variables

export function parseIntOrFallback<TFallback>(envVar: string | undefined, fallback: TFallback): TFallback | number {
    const parsedVal = parseInt(envVar || '')
    return Number.isInteger(parsedVal) ? parsedVal : fallback
}

