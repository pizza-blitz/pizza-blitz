import csv
import io
import re
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from sqlalchemy.orm import Session

from app.models.domain import DailySales, GoogleSheetSync


class SheetsService:
    def __init__(self):
        self.scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

    def extract_sheet_id(self, url: str) -> str:
        match = re.search(r"/d/([a-zA-Z0-9-_]+)", url)
        if match:
            return match.group(1)
        raise ValueError("Invalid Google Sheets URL")

    def extract_gid(self, url: str) -> str:
        parsed = urlparse(url)
        query_gid = parse_qs(parsed.query).get("gid", [None])[0]
        if query_gid:
            return query_gid
        fragment_gid = parse_qs(parsed.fragment).get("gid", [None])[0]
        return fragment_gid or "0"

    def public_csv_export_url(self, sheet_url: str) -> str:
        sheet_id = self.extract_sheet_id(sheet_url)
        gid = self.extract_gid(sheet_url)
        return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"

    def fetch_public_csv_rows(self, sheet_url: str) -> List[List[str]]:
        csv_url = sheet_url if "export?format=csv" in sheet_url else self.public_csv_export_url(sheet_url)
        request = Request(
            csv_url,
            headers={
                "User-Agent": "PizzaBlitzImporter/1.0",
                "Accept": "text/csv,text/plain,*/*",
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read()
        except HTTPError as exc:
            if exc.code in {401, 403, 404}:
                raise PermissionError(
                    "Google blocked this sheet export. Share the sheet as 'Anyone with the link: Viewer' or publish the tab, then retry."
                ) from exc
            raise RuntimeError(f"Google Sheets export failed with HTTP {exc.code}.") from exc
        except URLError as exc:
            raise RuntimeError(f"Could not reach Google Sheets: {exc.reason}") from exc

        text = raw.decode("utf-8-sig", errors="replace")
        first_chunk = text[:800].lower()
        if "<!doctype html" in first_chunk or "sign in to your google account" in first_chunk:
            raise PermissionError(
                "This Google Sheet is private right now. Share it as 'Anyone with the link: Viewer' or publish the tab, then retry."
            )

        return list(csv.reader(io.StringIO(text)))

    def fetch_all_sheet_tabs(self, sheet_url: str) -> List[str]:
        sheet_id = self.extract_sheet_id(sheet_url)
        try:
            import google.auth
            from googleapiclient.discovery import build

            credentials, _project = google.auth.default(scopes=self.scopes)
            service = build("sheets", "v4", credentials=credentials)
            spreadsheet = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
            return [sheet["properties"]["title"] for sheet in spreadsheet.get("sheets", [])]
        except Exception:
            return []

    def fetch_sheet_data(self, sheet_url: str, range_name: str = "A:Z") -> List[List[Any]]:
        sheet_id = self.extract_sheet_id(sheet_url)
        try:
            import google.auth
            from googleapiclient.discovery import build

            credentials, _project = google.auth.default(scopes=self.scopes)
            service = build("sheets", "v4", credentials=credentials)
            result = service.spreadsheets().values().get(spreadsheetId=sheet_id, range=range_name).execute()
            return result.get("values", [])
        except Exception:
            return []

    def parse_sheet_date(self, value: Any, tab_name: str | None = None) -> datetime:
        raw = str(value or "").strip()
        if not raw:
            raise ValueError("Missing date")

        if re.fullmatch(r"\d+(\.\d+)?", raw):
            serial = float(raw)
            if serial > 25000:
                return datetime(1899, 12, 30) + timedelta(days=int(serial))

        cleaned = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", raw, flags=re.IGNORECASE)
        cleaned = cleaned.replace(",", " ").replace("\\", "/")
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        month_formats = [
            "%Y-%m-%d",
            "%d-%m-%Y",
            "%d/%m/%Y",
            "%d.%m.%Y",
            "%d %m %Y",
            "%d-%b-%Y",
            "%d/%b/%Y",
            "%d %b %Y",
            "%d-%B-%Y",
            "%d/%B/%Y",
            "%d %B %Y",
            "%d-%b-%y",
            "%d/%b/%y",
            "%d %b %y",
            "%d-%m-%y",
            "%d/%m/%y",
        ]
        for date_format in month_formats:
            try:
                return datetime.strptime(cleaned, date_format)
            except ValueError:
                pass

        fallback_year = self._year_from_tab(tab_name) or datetime.utcnow().year
        for date_format in ("%d-%b", "%d/%b", "%d %b", "%d-%B", "%d/%B", "%d %B", "%d-%m", "%d/%m"):
            try:
                parsed = datetime.strptime(cleaned, date_format)
                return parsed.replace(year=fallback_year)
            except ValueError:
                pass

        raise ValueError(f"Could not parse date '{raw}'")

    def _year_from_tab(self, tab_name: str | None) -> int | None:
        if not tab_name:
            return None
        match = re.search(r"(20\d{2})|(\d{2})$", tab_name)
        if not match:
            return None
        year = match.group(0)
        return int(year) if len(year) == 4 else 2000 + int(year)

    def _money(self, value: Any) -> Decimal:
        raw = str(value or "").strip()
        if not raw or raw in {"-", "--"}:
            return Decimal("0")
        negative = raw.startswith("(") and raw.endswith(")")
        cleaned = re.sub(r"(?i)(rs\.?|inr|rupees)", "", raw)
        cleaned = re.sub(r"[^\d.\-]", "", cleaned)
        if cleaned in {"", "-", "."}:
            return Decimal("0")
        try:
            amount = Decimal(cleaned)
            return -amount if negative else amount
        except InvalidOperation:
            return Decimal("0")

    def _normalize_header(self, value: Any) -> str:
        return re.sub(r"[^a-z0-9]", "", str(value or "").lower())

    def _column_map(self, rows: List[List[Any]]) -> tuple[Dict[str, int], int]:
        aliases = {
            "date": {"date", "day", "businessdate", "saledate", "dt"},
            "cash": {"cash", "cashcollected", "cashcollection", "cashinhand", "collection"},
            "expense": {"expense", "expenses", "totalexpense", "totalexpenses", "cost", "totalcost"},
            "sale": {"sale", "sales", "totalsale", "totalsales", "revenue", "grosssale", "netsale", "amount"},
            "payment_method": {"payment", "paymentmethod", "method", "mode"},
            "notes": {"note", "notes", "remark", "remarks", "description"},
        }

        for index, row in enumerate(rows[:15]):
            normalized = [self._normalize_header(cell) for cell in row]
            mapping: Dict[str, int] = {}
            for field, names in aliases.items():
                for column_index, header in enumerate(normalized):
                    if header in names:
                        mapping[field] = column_index
                        break
            if "date" in mapping and any(field in mapping for field in ("sale", "cash", "expense")):
                return mapping, index + 1

        start_index = 1
        if rows:
            try:
                self.parse_sheet_date(rows[0][0] if rows[0] else "")
                start_index = 0
            except ValueError:
                start_index = 1
        return {"date": 0, "cash": 1, "expense": 2, "sale": 3}, start_index

    def _cell(self, row: List[Any], index: int | None) -> Any:
        if index is None or index >= len(row):
            return ""
        return row[index]

    def import_rows(
        self,
        db: Session,
        rows: List[List[Any]],
        *,
        source_label: str,
        mode: str = "all",
        tab_name: str | None = None,
    ) -> Dict[str, Any]:
        if not rows:
            return {
                "rows_found": 0,
                "rows_imported": 0,
                "rows_created": 0,
                "rows_updated": 0,
                "rows_skipped": 0,
                "skip_reasons": ["No rows found in the sheet export."],
            }

        mapping, start_index = self._column_map(rows)
        rows_found = 0
        imported = 0
        created = 0
        updated = 0
        skipped = 0
        skip_reasons: List[str] = []
        imported_dates: List[str] = []
        current = datetime.utcnow().date()

        for display_index, row in enumerate(rows[start_index:], start=start_index + 1):
            if not any(str(cell or "").strip() for cell in row):
                continue
            rows_found += 1
            try:
                parsed_date = self.parse_sheet_date(self._cell(row, mapping.get("date")), tab_name).date()
            except ValueError as exc:
                skipped += 1
                if len(skip_reasons) < 8:
                    skip_reasons.append(f"Row {display_index}: {exc}")
                continue

            if mode == "current" and (parsed_date.year != current.year or parsed_date.month != current.month):
                continue

            sale = self._money(self._cell(row, mapping.get("sale")))
            cash = self._money(self._cell(row, mapping.get("cash")))
            expense = self._money(self._cell(row, mapping.get("expense")))
            if sale == 0 and cash > 0:
                sale = cash
            if cash == 0 and sale > 0:
                cash = sale
            if sale == 0 and cash == 0 and expense == 0:
                skipped += 1
                if len(skip_reasons) < 8:
                    skip_reasons.append(f"Row {display_index}: no sale, cash, or expense amount found.")
                continue

            notes = str(self._cell(row, mapping.get("notes")) or "").strip()
            payment_method = str(self._cell(row, mapping.get("payment_method")) or "mixed").strip() or "mixed"

            sale_record = db.query(DailySales).filter(DailySales.date == parsed_date).first()
            if sale_record:
                updated += 1
            else:
                created += 1
                sale_record = DailySales(date=parsed_date)
                db.add(sale_record)

            sale_record.cash_collected = cash
            sale_record.total_expense = expense
            sale_record.total_sale = sale
            sale_record.profit = sale - expense
            sale_record.payment_method = payment_method
            sale_record.notes = notes or f"Imported from {source_label}"
            imported += 1
            imported_dates.append(parsed_date.isoformat())

        db.commit()

        return {
            "rows_found": rows_found,
            "rows_imported": imported,
            "rows_created": created,
            "rows_updated": updated,
            "rows_skipped": skipped,
            "skip_reasons": skip_reasons,
            "date_start": min(imported_dates) if imported_dates else None,
            "date_end": max(imported_dates) if imported_dates else None,
        }

    def _import_with_google_credentials(self, db: Session, sheet_url: str, mode: str) -> Dict[str, Any] | None:
        tabs = self.fetch_all_sheet_tabs(sheet_url)
        if not tabs:
            return None

        combined = {
            "rows_found": 0,
            "rows_imported": 0,
            "rows_created": 0,
            "rows_updated": 0,
            "rows_skipped": 0,
            "skip_reasons": [],
            "tabs_processed": [],
            "date_start": None,
            "date_end": None,
        }

        for tab in tabs:
            if "summary" in tab.lower() or "yearly" in tab.lower():
                continue
            rows = self.fetch_sheet_data(sheet_url, range_name=f"'{tab}'!A:Z")
            result = self.import_rows(db, rows, source_label=f"Google tab {tab}", mode=mode, tab_name=tab)
            if result["rows_found"] == 0:
                continue
            combined["tabs_processed"].append(tab)
            for key in ("rows_found", "rows_imported", "rows_created", "rows_updated", "rows_skipped"):
                combined[key] += int(result.get(key) or 0)
            combined["skip_reasons"].extend(result.get("skip_reasons", [])[:3])
            if result.get("date_start"):
                combined["date_start"] = min(
                    [date for date in [combined["date_start"], result["date_start"]] if date]
                )
            if result.get("date_end"):
                combined["date_end"] = max(
                    [date for date in [combined["date_end"], result["date_end"]] if date]
                )

        return {
            **combined,
            "months_processed": len(combined["tabs_processed"]),
            "source": "google_sheets_api",
            "status": "success",
        }

    def process_and_import(self, db: Session, sheet_url: str, mode: str = "all") -> Dict[str, Any]:
        if mode == "all":
            credential_result = self._import_with_google_credentials(db, sheet_url, mode)
            if credential_result and credential_result["rows_imported"] > 0:
                self._log_sync(db, sheet_url, credential_result["rows_imported"], "success")
                return credential_result

        rows = self.fetch_public_csv_rows(sheet_url)
        result = self.import_rows(
            db,
            rows,
            source_label="linked Google Sheet tab",
            mode=mode,
        )
        if result["rows_imported"] == 0:
            self._log_sync(db, sheet_url, 0, "failed")
            return {
                **result,
                "months_processed": 0,
                "source": "public_csv_linked_tab",
                "status": "error",
                "message": "No daily sales rows could be imported from this sheet tab.",
            }

        self._log_sync(db, sheet_url, result["rows_imported"], "success")
        return {
            **result,
            "months_processed": 1,
            "source": "public_csv_linked_tab",
            "status": "success",
        }

    def _log_sync(self, db: Session, sheet_url: str, rows_imported: int, status: str) -> None:
        sync_log = GoogleSheetSync(
            sheet_id=self.extract_sheet_id(sheet_url),
            sync_status=status,
            rows_imported=rows_imported,
            last_synced_at=datetime.utcnow(),
        )
        db.add(sync_log)
        db.commit()
