# AstroClimate — common commands.
#   just              list recipes
#   just setup        install both toolchains
#   just build <id>   fetch history and rebuild one location

set positional-arguments

app_dir := "app"
default_location := "schererville-in"

# List available recipes.
default:
    @just --list --unsorted

# ---------------------------------------------------------------- setup

# Install Python and Node dependencies.
setup: setup-py setup-js

setup-py:
    uv sync --extra dev

setup-js:
    cd {{app_dir}} && npm install

# ---------------------------------------------------------------- data

# Fetch history and rebuild climatology for one location.
build location=default_location:
    uv run python scripts/build_location.py {{location}}

# Rebuild every location in locations/locations.yaml.
build-all:
    uv run python scripts/update_locations.py

# Download raw ERA5 years into cache/ without rebuilding.
fetch location=default_location:
    uv run python scripts/fetch_history.py {{location}}

# Rebuild climatology from the existing cache, skipping the network.
climatology location=default_location:
    uv run python scripts/build_climatology.py {{location}}

# Check every built location file. Run before committing regenerated data.
validate:
    uv run python scripts/validate_data.py

# Show what is currently cached and built.
status:
    @echo "cached raw data:"
    @du -sh cache/*/ 2>/dev/null || echo "  (none)"
    @echo "\nbuilt location files:"
    @ls -lh app/public/data/locations/*.json 2>/dev/null | awk '{print "  " $9 " " $5}' || echo "  (none)"

# ---------------------------------------------------------------- app

# Vite dev server with hot reload.
dev:
    cd {{app_dir}} && npm run dev

# Production build into app/dist.
build-app:
    cd {{app_dir}} && npm run build

# Build and serve exactly what GitHub Pages will serve.
preview: build-app
    cd {{app_dir}} && npm run preview

# ---------------------------------------------------------------- checks

# Everything CI would run.
check: lint typecheck test validate

test: test-py test-js

test-py:
    uv run --extra dev pytest -q

test-js:
    cd {{app_dir}} && npm test

lint:
    uvx ruff check scripts/ tests/

# Apply ruff's safe fixes.
fmt:
    uvx ruff check --fix scripts/ tests/

typecheck:
    cd {{app_dir}} && npm run typecheck

# ---------------------------------------------------------------- misc

# Delete built output and caches. Raw ERA5 downloads are kept.
clean:
    rm -rf {{app_dir}}/dist
    find . -name __pycache__ -type d -prune -exec rm -rf {} +

# Delete raw downloads too. The next build re-fetches ~30 requests per location.
clean-cache: clean
    rm -rf cache/*/
