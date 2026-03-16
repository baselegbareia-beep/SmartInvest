#!/usr/bin/env python3
"""
Process downloaded CSV data for VIX, S&P 500, and Gold.
Selects one day per month: the 3rd highest VIX day after the month's peak VIX day.
Outputs data/chart_data.json for the website.
"""

import csv
import json
import os
from collections import defaultdict


def load_vix_daily(path="/tmp/vix-daily.csv"):
    """Load VIX daily data. Format: DATE,OPEN,HIGH,LOW,CLOSE"""
    data = {}
    with open(path, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Date format: MM/DD/YYYY
            parts = row["DATE"].split("/")
            if len(parts) == 3:
                date = f"{parts[2]}-{parts[0].zfill(2)}-{parts[1].zfill(2)}"
                try:
                    data[date] = float(row["CLOSE"])
                except (ValueError, KeyError):
                    pass
    return data


def load_sp500_daily(path="/tmp/sp500_daily.csv"):
    """Load S&P 500 daily data. Format: Date,High,Low,Open,Close,Volume,Adj Close"""
    data = {}
    with open(path, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            date = row["Date"][:10]  # YYYY-MM-DD
            try:
                data[date] = float(row["Close"])
            except (ValueError, KeyError):
                pass
    return data


def load_sp500_monthly(path="/tmp/sp500_shiller.csv"):
    """Load S&P 500 monthly data. Format: Date,SP500,..."""
    data = {}
    with open(path, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            date = row["Date"][:7]  # YYYY-MM
            try:
                val = float(row["SP500"])
                if val > 0:
                    data[date] = val
            except (ValueError, KeyError):
                pass
    return data


def load_gold_daily(path="/tmp/gold_daily.csv"):
    """Load Gold daily data. Format: date,price"""
    data = {}
    with open(path, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            date = row["date"]  # YYYY-MM-DD
            try:
                data[date] = float(row["price"])
            except (ValueError, KeyError):
                pass
    return data


def load_gold_monthly(path="/tmp/gold_monthly.csv"):
    """Load Gold monthly data. Format: Date,Price"""
    data = {}
    with open(path, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            date = row["Date"]  # YYYY-MM
            try:
                val = float(row["Price"])
                if val > 0:
                    data[date] = val
            except (ValueError, KeyError):
                pass
    return data


def select_monthly_dates(vix_daily):
    """
    For each month from 1995-01 onward:
    1. Find the highest VIX day in that month
    2. Among days AFTER that peak, find the 3rd highest VIX day
    3. If not enough days after peak, fallback to 3rd highest overall
    """
    # Group VIX by month
    months = defaultdict(list)
    for date, val in vix_daily.items():
        if date < "1995-01":
            continue
        month_key = date[:7]
        months[month_key].append((date, val))

    selected = []
    for month_key in sorted(months.keys()):
        entries = months[month_key]
        if len(entries) < 4:
            continue

        # Sort by VIX value descending
        by_vix = sorted(entries, key=lambda x: x[1], reverse=True)
        max_date = by_vix[0][0]  # Highest VIX day

        # Get days AFTER the highest VIX day (chronologically)
        after_max = [(d, v) for d, v in entries if d > max_date]
        after_max_sorted = sorted(after_max, key=lambda x: x[1], reverse=True)

        if len(after_max_sorted) >= 3:
            selected.append(after_max_sorted[2])  # 3rd highest after peak
        elif len(by_vix) >= 3:
            selected.append(by_vix[2])  # Fallback: 3rd highest overall

    return sorted(selected, key=lambda x: x[0])


def build_chart_data(selected, vix_daily, sp500_daily, sp500_monthly,
                     gold_daily, gold_monthly):
    """Build the final chart data JSON structure."""
    labels = []
    vix_values = []
    sp500_values = []
    gold_values = []

    for date, vix_val in selected:
        month_key = date[:7]

        # Get S&P 500 value: daily first, fallback to monthly
        sp_val = sp500_daily.get(date) or sp500_monthly.get(month_key)

        # Get Gold value: daily first, fallback to monthly
        gold_val = gold_daily.get(date) or gold_monthly.get(month_key)

        if sp_val is not None:
            labels.append(date)
            vix_values.append(round(vix_val, 2))
            sp500_values.append(round(sp_val, 2))
            gold_values.append(round(gold_val, 2) if gold_val else None)

    return {
        "labels": labels,
        "vix": vix_values,
        "sp500": sp500_values,
        "gold": gold_values
    }


def main():
    print("Loading VIX daily data...")
    vix_daily = load_vix_daily()
    print(f"  {len(vix_daily)} days loaded")

    print("Loading S&P 500 daily data...")
    sp500_daily = load_sp500_daily()
    print(f"  {len(sp500_daily)} days loaded")

    print("Loading S&P 500 monthly data...")
    sp500_monthly = load_sp500_monthly()
    print(f"  {len(sp500_monthly)} months loaded")

    print("Loading Gold daily data...")
    gold_daily = load_gold_daily()
    print(f"  {len(gold_daily)} days loaded")

    print("Loading Gold monthly data...")
    gold_monthly = load_gold_monthly()
    print(f"  {len(gold_monthly)} months loaded")

    print("\nSelecting monthly dates based on VIX criteria...")
    selected = select_monthly_dates(vix_daily)
    print(f"  Selected {len(selected)} monthly data points")

    if selected:
        print(f"  Range: {selected[0][0]} to {selected[-1][0]}")

    chart_data = build_chart_data(
        selected, vix_daily, sp500_daily, sp500_monthly,
        gold_daily, gold_monthly
    )

    os.makedirs("data", exist_ok=True)
    output = os.path.join("data", "chart_data.json")
    with open(output, "w") as f:
        json.dump(chart_data, f, indent=None, separators=(",", ":"))

    file_size = os.path.getsize(output)
    print(f"\nSaved to {output} ({file_size / 1024:.1f} KB)")
    print(f"Data points: {len(chart_data['labels'])}")
    if chart_data["labels"]:
        print(f"Date range: {chart_data['labels'][0]} to {chart_data['labels'][-1]}")

        # Show a few sample entries
        print("\nSample data points:")
        for i in [0, len(chart_data['labels']) // 2, -1]:
            print(f"  {chart_data['labels'][i]}: "
                  f"VIX={chart_data['vix'][i]}, "
                  f"S&P500={chart_data['sp500'][i]}, "
                  f"Gold={chart_data['gold'][i]}")


if __name__ == "__main__":
    main()
