# devmailbox — run `just` to list recipes.

default:
    @just --list

# Install dependencies
install:
    bun install --frozen-lockfile

# Run the server (HTTP :7430, SMTP :2525)
serve:
    bun server/main.ts serve

# Run the server, restarting on changes
dev:
    bun --watch server/main.ts serve

# Run the dashboard with hot reload, proxying to `just dev` (open the URL it prints)
dev-web:
    bunx vite web

# Build the dashboard into web/dist, which the server serves at /
build-web:
    bunx vite build web

# Check the configuration and that the ports are free
doctor:
    bun server/main.ts doctor

# Run the tests (no external services needed)
test *args:
    bun test {{args}}

# Typecheck the server, tests and dashboard
typecheck:
    bunx tsc --noEmit -p .
    bunx tsc --noEmit -p web

# Typecheck, test and build the dashboard, as CI does
check: typecheck test build-web

# Build a single self-contained binary at dist/devmailbox, dashboard included
compile: build-web
    bun scripts/compile.ts dist/devmailbox

# Build the container image
image tag="devmailbox":
    podman build -f service/Containerfile -t {{tag}} .
