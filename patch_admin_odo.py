import re

with open("/Users/admin/Desktop/My-Volt-App/backend/server.py", "r") as f:
    content = f.read()

admin_odo_logic = """
class AdminOdometerBody(BaseModel):
    reading: int

@api.post("/admin/drivers/{driver_id}/odometer")
async def admin_submit_odometer(driver_id: str, body: AdminOdometerBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "city_manager", "staff"])
    
    driver = await db.drivers.find_one(org_filter(user, {"_id": oid(driver_id)}))
    if not driver:
        raise HTTPException(404, "Driver not found")
        
    reading = body.reading
    today = datetime.utcnow().strftime("%Y-%m-%d")
    current_month_str = datetime.utcnow().strftime("%Y-%m")
    url = ""  # No image for admin override
    
    active_trip_id = driver.get("active_trip_id")
    
    if not active_trip_id:
        # START TRIP
        acct = await db.rental_accounts.find_one({"driver_id": driver_id})
        
        # Add daily rent to outstanding AT START
        rental = await _active_rental(driver.get("organization_id"), driver_id)
        daily_rate = 0
        if rental:
            plan = None
            if rental.get("package_id"): plan = await db.rental_plans.find_one({"_id": oid(rental["package_id"])})
            elif rental.get("package_name"): plan = await db.rental_plans.find_one({"name": {"$regex": f"^{rental['package_name']}$", "$options": "i"}, "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"}, "organization_id": driver.get("organization_id")})
            daily_rate = plan.get("amount", rental.get("daily_rate", 0)) if plan else rental.get("daily_rate", 0)
            
        if daily_rate > 0:
            await db.rental_accounts.update_one(
                {"driver_id": driver_id},
                {"$inc": {"outstanding_amount": daily_rate}, "$addToSet": {"unpaid_dates": today}},
                upsert=True
            )
            
        res = await db.driver_odometer_logs.insert_one({
            "driver_id": driver_id,
            "organization_id": driver.get("organization_id"),
            "date": today,
            "start_reading": reading,
            "start_image_url": url,
            "status": "active",
            "created_at": now_iso()
        })
        
        await db.drivers.update_one(
            {"_id": ObjectId(driver_id)},
            {"$set": {
                "active_trip_id": str(res.inserted_id),
                "last_odometer_date": today
            }}
        )
        return {"ok": True, "message": "Trip started successfully by admin"}
    else:
        # END TRIP
        log = await db.driver_odometer_logs.find_one({"_id": ObjectId(active_trip_id)})
        if not log:
            await db.drivers.update_one({"_id": ObjectId(driver_id)}, {"$unset": {"active_trip_id": ""}})
            raise HTTPException(400, "Active trip not found. Please start a new trip.")
            
        start_reading = log.get("start_reading", reading)
        if reading < start_reading:
            raise HTTPException(400, f"Ending reading ({reading}) cannot be less than starting reading ({start_reading}).")
            
        driven = reading - start_reading
        
        current_month_kms = driver.get("current_month_kms", 0)
        if driver.get("current_month") != current_month_str:
            current_month_kms = 0
            
        current_month_kms += driven
        
        await db.driver_odometer_logs.update_one(
            {"_id": ObjectId(active_trip_id)},
            {"$set": {
                "end_reading": reading,
                "end_image_url": url,
                "driven_today": driven,
                "status": "completed",
                "completed_at": now_iso()
            }}
        )
        
        # Calculate Billing and Overages
        rental = await _active_rental(driver.get("organization_id"), driver_id)
        daily_rate = rental.get("daily_rate", 0) if rental else 0
        
        limit_km = 0
        overage_per_km = 0.0
        
        if rental:
            plan = None
            if rental.get("package_id"):
                plan = await db.rental_plans.find_one({"_id": oid(rental["package_id"])})
            elif rental.get("package_name"):
                plan = await db.rental_plans.find_one({
                    "name": {"$regex": f"^{rental['package_name']}$", "$options": "i"}, 
                    "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"},
                    "organization_id": driver.get("organization_id")
                })
                
            daily_limit_km = 0
            overage_per_km = 0.0
            if plan:
                monthly_limit_km = plan.get("monthly_km_limit", 0)
                overage_per_km = plan.get("overage_per_km", 0.0)
                daily_rate = plan.get("amount", daily_rate)
                
                import calendar
                now = datetime.now()
                days_in_month = calendar.monthrange(now.year, now.month)[1]
                
                daily_limit_km = round(monthly_limit_km / days_in_month) if days_in_month else 0
                
        overage_km = max(0, driven - daily_limit_km)
        overage_charge = overage_km * overage_per_km
        
        if overage_charge > 0:
            await db.rental_accounts.update_one(
                {"driver_id": driver_id},
                {
                    "$inc": {"outstanding_amount": overage_charge},
                    "$addToSet": {"unpaid_dates": today}
                },
                upsert=True
            )
            
        await db.drivers.update_one(
            {"_id": ObjectId(driver_id)},
            {
                "$set": {
                    "last_odometer_reading": reading,
                    "current_month_kms": current_month_kms,
                    "current_month": current_month_str
                },
                "$unset": {
                    "active_trip_id": ""
                }
            }
        )
        
        msg = f"Trip ended by admin! Driven: {driven} km."
        if overage_km > 0:
            msg += f" (Overage: {overage_km} km / ₹{overage_charge})"
        return {"ok": True, "message": msg}
"""

if "admin_submit_odometer" not in content:
    content = content.replace("@api.post(\"/driver/odometer\")", admin_odo_logic + "\n\n@api.post(\"/driver/odometer\")")
    with open("/Users/admin/Desktop/My-Volt-App/backend/server.py", "w") as f:
        f.write(content)
    print("Added admin_submit_odometer")
else:
    print("Already exists")
