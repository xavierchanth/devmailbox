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

# Check the configuration and that the ports are free
doctor:
    bun server/main.ts doctor

# Run the tests (no external services needed)
test *args:
    bun test {{args}}

typecheck:
    bunx tsc --noEmit -p .

# Typecheck and test, as CI does
check: typecheck test

# Build a single self-contained binary at dist/devmailbox
compile:
    bun build --compile --minify --sourcemap server/main.ts --outfile dist/devmailbox

# Build the container image
image tag="devmailbox":
    podman build -f service/Containerfile -t {{tag}} .
