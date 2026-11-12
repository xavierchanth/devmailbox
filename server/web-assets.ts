// The built dashboard embedded in the compiled binary: URL path → embedded file path. null when
// running from source, which serves web/dist from disk. scripts/compile.ts replaces this module
// at build time; don't import web files here.

export const WEB_ASSETS: Record<string, string> | null = null;
