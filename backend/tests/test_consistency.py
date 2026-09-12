"""Cross-checks between dashboard KPIs and list endpoints (data consistency)."""
import pytest
from conftest import API


def test_payment_pending_kpi_matches_rentals_filter(admin):
    summary = admin.get(f"{API}/dashboard/summary?city=all", timeout=30).json()
    kpi = summary["rentals"]["payment_pending"]
    filtered = admin.get(f"{API}/rentals?status=pending_payment", timeout=30).json()
    all_rentals = admin.get(f"{API}/rentals", timeout=30).json()
    unpaid = [r for r in all_rentals if r.get("payment_status") in ("pending", "partial") and r.get("status") != "closed"]
    print(f"kpi={kpi} status_filter_count={len(filtered)} unpaid_by_payment_status={len(unpaid)}")
    assert kpi == len(filtered), (
        f"Dashboard 'payment_pending' KPI ({kpi}) does not match /rentals?status=pending_payment "
        f"({len(filtered)}); the Needs-Attention deep link lands on an empty list. "
        f"Rentals with payment_status pending/partial = {len(unpaid)}"
    )


def test_active_kpi_matches_rentals_active_filter(admin):
    summary = admin.get(f"{API}/dashboard/summary?city=all", timeout=30).json()
    kpi = summary["rentals"]["active"]
    filtered = admin.get(f"{API}/rentals?status=active", timeout=30).json()
    print(f"active kpi={kpi} filter={len(filtered)}")
    assert abs(kpi - len(filtered)) <= 0, f"active KPI {kpi} vs active filter {len(filtered)}"


def test_fleet_total_reachable_via_pagination(admin):
    first = admin.get(f"{API}/vehicles?page=1&page_size=120", timeout=30).json()
    total = first["total"]
    assert total > 0
    # frontend requests page_size=120 only (no pagination controls) -> flag if total exceeds one page
    assert total <= 120, f"Fleet has {total} vehicles but UI fetches only 120 with no pagination control"
