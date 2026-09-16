import sys
from pathlib import Path

# Tests import the pipeline as `scripts.*`, which requires the repo root on the
# path regardless of where pytest is invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
