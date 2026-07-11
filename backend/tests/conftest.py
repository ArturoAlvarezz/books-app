"""Configuración de pytest para asegurar que ``app`` es importable."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))