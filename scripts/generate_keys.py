#!/usr/bin/env python3
"""Print fresh APP_SECRET_KEY and FERNET_KEY values for your .env file."""
from __future__ import annotations

import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cryptography.fernet import Fernet  # noqa: E402


def main() -> None:
    print("# Paste these into your .env:")
    print(f"APP_SECRET_KEY={secrets.token_urlsafe(48)}")
    print(f"FERNET_KEY={Fernet.generate_key().decode()}")


if __name__ == "__main__":
    main()
