"""Pydantic models shared by the API, the agents and the tools."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

ORDER_STATUSES = ("requested", "accepted", "confirmed", "in_production", "ready", "completed",
                  "declined", "cancelled", "expired")
# Orders in these states hold kitchen time (capacity) and appear on the calendar.
ACTIVE_STATUSES = ("requested", "accepted", "confirmed", "in_production", "ready")
# Orders the kitchen is committed to (used for shopping lists and production plans).
COMMITTED_STATUSES = ("accepted", "confirmed", "in_production", "ready")


class AddonPick(BaseModel):
    code: str
    qty: int = Field(default=1, ge=1, le=12)


class OrderSpec(BaseModel):
    """The structured order every agent and tool works from. Prices are never part of it."""
    occasion: str = Field(default="", max_length=200)
    guest_count: int | None = Field(default=None, ge=1, le=400)
    recipient_name: str | None = Field(default=None, max_length=80)
    size_code: str = ""
    cake_flavor: str = ""
    filling: str = "none"
    frosting: str = ""
    addons: list[AddonPick] = Field(default_factory=list, max_length=15)
    design_notes: str = Field(default="", max_length=1500)
    message_on_cake: str | None = Field(default=None, max_length=60)
    inspiration_image_id: int | None = None
    allergies: str = Field(default="", max_length=300)
    dietary: str | None = Field(default=None, max_length=120)
    pickup_date: str | None = None
    pickup_time: str | None = None
    fulfillment: Literal["pickup", "delivery"] = "pickup"
    delivery_zone: Literal["new_haven", "nearby", "far"] | None = None
    delivery_address: str | None = Field(default=None, max_length=300)

    @field_validator("addons")
    @classmethod
    def merge_duplicates(cls, v: list[AddonPick]) -> list[AddonPick]:
        merged: dict[str, int] = {}
        for a in v:
            merged[a.code] = min(12, merged.get(a.code, 0) + a.qty)
        return [AddonPick(code=c, qty=q) for c, q in merged.items()]


DRAFT_FIELDS = tuple(OrderSpec.model_fields)


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=8, max_length=128)
    phone: str | None = Field(default=None, max_length=30)


class LoginIn(BaseModel):
    email: str = Field(max_length=120)
    password: str = Field(max_length=128)


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=1500)
    history: list[ChatTurn] = Field(default_factory=list, max_length=40)
    draft: dict = Field(default_factory=dict)
    inspiration_image_id: int | None = None


class AcceptIn(BaseModel):
    final_price: float = Field(gt=0, le=10_000)
    owner_note: str | None = Field(default=None, max_length=1000)


class DeclineIn(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class StatusIn(BaseModel):
    status: Literal["in_production", "ready", "completed"]


class PlanWeekIn(BaseModel):
    week_start: str | None = None


class InventoryPatch(BaseModel):
    qty_on_hand: float = Field(ge=0, le=1_000_000)


class ReceiptItemIn(BaseModel):
    item: str = Field(max_length=120)
    qty: float = Field(ge=0, le=100_000)
    unit: str = Field(default="", max_length=40)
    line_total: float = Field(ge=0, le=10_000)
    inventory_id: int | None = None


class ReceiptRejectIn(BaseModel):
    reason: str = Field(default="", max_length=300)


class ReceiptConfirmIn(BaseModel):
    vendor: str = Field(max_length=120)
    date: str
    total: float = Field(ge=0, le=10_000)
    items: list[ReceiptItemIn] = Field(default_factory=list, max_length=80)
