import os

import requests


API_KEY = os.getenv("GOOGLE_SHEETS_API_KEY")
SPREADSHEET_ID = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID")


def test_access() -> bool:
    if not API_KEY or not SPREADSHEET_ID:
        raise RuntimeError(
            "Set GOOGLE_SHEETS_API_KEY and GOOGLE_SHEETS_SPREADSHEET_ID first."
        )

    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}?key={API_KEY}"
    response = requests.get(url, timeout=15)
    if response.status_code == 200:
        data = response.json()
        sheets = [sheet["properties"]["title"] for sheet in data["sheets"]]
        print(f"SUCCESS: Found {len(sheets)} tabs: {', '.join(sheets)}")
        return True

    print(f"FAILED: {response.status_code} - {response.text}")
    return False


if __name__ == "__main__":
    test_access()

