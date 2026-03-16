#!/usr/bin/env python3
"""
Fetch monthly VIX, S&P 500, and Gold data since 1995.
Day selection: for each month, pick the 3rd highest VIX day
that occurs AFTER the highest VIX day in that month.
Outputs data/chart_data.json for use by the HTML chart.
"""

import json
import os
from datetime import datetime

import pandas as pd
import yfinance as yf


def fetch_daily_data():
    """Download daily data for VIX, S&P 500, and Gold from 1995 to present."""
    start = "1995-01-01"
    end = datetime.now().strftime("%Y-%m-%d")

    print("Fetching VIX daily data...")
    vix = yf.download("^VIX", start=start, end=end, auto_adjust=True)["Close"]

    print("Fetching S&P 500 daily data...")
    sp500 = yf.download("^GSPC", start=start, end=end, auto_adjust=True)["Close"]

    print("Fetching Gold daily data...")
    gold = yf.download("GC=F", start=start, end=end, auto_adjust=True)["Close"]

    return vix, sp500, gold


def select_monthly_dates(vix_daily):
    """
    For each month, find the 3rd highest VIX day that occurs
    AFTER the highest VIX day in that month.
    Returns a list of selected dates.
    """
    # Flatten multi-index columns if present
    if hasattr(vix_daily, 'columns'):
        vix_series = vix_daily.squeeze()
    else:
        vix_series = vix_daily

    vix_series = vix_series.dropna()
    vix_series.index = pd.to_datetime(vix_series.index)

    # Group by year-month
    grouped = vix_series.groupby(vix_series.index.to_period("M"))

    selected_dates = []
    for period, group in grouped:
        if len(group) < 4:
            continue

        # Find the highest VIX day
        max_vix_date = group.idxmax()

        # Get days AFTER the highest VIX day in this month
        after_max = group[group.index > max_vix_date]

        if len(after_max) < 3:
            # Not enough days after the max; use the 3rd highest overall
            sorted_days = group.sort_values(ascending=False)
            if len(sorted_days) >= 3:
                selected_dates.append(sorted_days.index[2])
            continue

        # Sort remaining days by VIX descending and pick the 3rd highest
        sorted_after = after_max.sort_values(ascending=False)
        if len(sorted_after) >= 3:
            selected_dates.append(sorted_after.index[2])
        elif len(sorted_after) >= 1:
            selected_dates.append(sorted_after.index[-1])

    return sorted(selected_dates)


def build_chart_data(selected_dates, vix_daily, sp500_daily, gold_daily):
    """Build JSON-serializable chart data for the selected dates."""

    def to_series(data):
        s = data.squeeze() if hasattr(data, 'columns') else data
        s.index = pd.to_datetime(s.index)
        return s

    vix_s = to_series(vix_daily)
    sp_s = to_series(sp500_daily)
    gold_s = to_series(gold_daily)

    labels = []
    vix_values = []
    sp500_values = []
    gold_values = []

    for date in selected_dates:
        date_ts = pd.Timestamp(date)
        if date_ts in vix_s.index and date_ts in sp_s.index:
            labels.append(date_ts.strftime("%Y-%m-%d"))
            vix_values.append(round(float(vix_s.loc[date_ts]), 2))
            sp500_values.append(round(float(sp_s.loc[date_ts]), 2))
            # Gold data may not be available for all dates (GC=F starts ~2000)
            if date_ts in gold_s.index:
                gold_values.append(round(float(gold_s.loc[date_ts]), 2))
            else:
                gold_values.append(None)

    return {
        "labels": labels,
        "vix": vix_values,
        "sp500": sp500_values,
        "gold": gold_values,
    }


def main():
    vix_daily, sp500_daily, gold_daily = fetch_daily_data()

    print("Selecting monthly dates based on VIX criteria...")
    selected_dates = select_monthly_dates(vix_daily)
    print(f"Selected {len(selected_dates)} monthly data points")

    chart_data = build_chart_data(selected_dates, vix_daily, sp500_daily, gold_daily)

    os.makedirs("data", exist_ok=True)
    output_path = os.path.join("data", "chart_data.json")
    with open(output_path, "w") as f:
        json.dump(chart_data, f)

    print(f"Data saved to {output_path}")
    if chart_data["labels"]:
        print(f"Date range: {chart_data['labels'][0]} to {chart_data['labels'][-1]}")
    else:
        print("WARNING: No data points were generated. Check your network connection.")


if __name__ == "__main__":
    main()
