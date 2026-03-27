import csv
import json
from collections import Counter
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT_DIR / "assets" / "3M material list price US.csv"
OUTPUT_PATH = ROOT_DIR / "Sample" / "3m-catalog-core.full.json"


def normalize_header(name: str) -> str:
    return " ".join((name or "").replace("\ufeff", "").split())


def to_bool(value: str):
    raw = (value or "").strip().lower()
    if raw == "yes":
        return True
    if raw == "no":
        return False
    return None


def to_number(value: str):
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def to_pricing_mode(remove_by: str) -> str:
    raw = (remove_by or "").strip().lower()
    if raw == "each piece":
        return "per_piece"
    if raw == "percent":
        return "percent_of_container"
    return "unknown"


def extract_catalog():
    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        header_map = {h: normalize_header(h) for h in (reader.fieldnames or [])}

        rows = []
        for row in reader:
            normalized_row = {header_map.get(k, k): v for k, v in row.items()}

            item = {
                "partNumber": (normalized_row.get("Part Number") or "").strip(),
                "description": (normalized_row.get("Description") or "").strip(),
                "category": (normalized_row.get("Paint and Materials Category") or "").strip() or None,
                "containerCost": to_number(normalized_row.get("Container Cost")),
                "piecesPerContainer": to_number(normalized_row.get("Pieces Per Container")),
                "invoiceUnit": (normalized_row.get("Invoice Unit") or "").strip() or None,
                "packageType": (normalized_row.get("Size") or "").strip() or None,
                "taxable": to_bool(normalized_row.get("Taxable")),
                "recoverable": to_bool(normalized_row.get("Enable for Invoicing (Recoverable)")),
                "pricingMode": to_pricing_mode(normalized_row.get("Remove By")),
            }
            rows.append(item)

    return rows


def main():
    items = extract_catalog()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(items, indent=2), encoding="utf-8")

    part_numbers = [item["partNumber"] for item in items if item["partNumber"]]
    duplicate_count = sum(1 for _, c in Counter(part_numbers).items() if c > 1)

    print(f"Source: {CSV_PATH}")
    print(f"Output: {OUTPUT_PATH}")
    print(f"Total rows: {len(items)}")
    print(f"Unique part numbers: {len(set(part_numbers))}")
    print(f"Duplicated part numbers: {duplicate_count}")


if __name__ == "__main__":
    main()
