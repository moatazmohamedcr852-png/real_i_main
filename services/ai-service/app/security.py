from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import jwt
from fastapi import Header, HTTPException, Request, status

from .config import Settings


def _is_object_id(value: object) -> bool:
    return isinstance(value, str) and len(value) == 24 and all(character in "0123456789abcdefABCDEF" for character in value)


class InternalAuthenticationError(RuntimeError):
    pass


@dataclass(frozen=True)
class InternalPrincipal:
    actor_id: str
    actor_role: str
    scopes: frozenset[str]


def verify_internal_token(token: str, settings: Settings) -> InternalPrincipal:
    try:
        header = jwt.get_unverified_header(token)
        key_id = header.get("kid")
        key = settings.internal_jwt_keys.get(key_id)
        if not key:
            raise InternalAuthenticationError("Unknown signing key.")
        claims = jwt.decode(token, key, algorithms=["HS256"], issuer=settings.internal_jwt_issuer, audience=settings.internal_jwt_audience, options={"require": ["exp", "iat", "sub", "actor_id", "actor_role", "scopes"]})
        if claims["sub"] != "core-api" or not _is_object_id(claims["actor_id"]) or not isinstance(claims["actor_role"], str) or not isinstance(claims["scopes"], list) or not all(isinstance(scope, str) for scope in claims["scopes"]):
            raise InternalAuthenticationError("Invalid internal claims.")
        return InternalPrincipal(actor_id=claims["actor_id"], actor_role=claims["actor_role"], scopes=frozenset(claims["scopes"]))
    except (jwt.PyJWTError, InternalAuthenticationError) as error:
        raise InternalAuthenticationError("Invalid internal credentials.") from error


def request_id_from_header(x_request_id: str | None = Header(default=None)) -> str:
    if not x_request_id or len(x_request_id) > 128 or not all(char.isalnum() or char in "-_:" for char in x_request_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A valid x-request-id is required.")
    return x_request_id


def require_internal(*required_scopes: str) -> Callable:
    async def dependency(request: Request, authorization: str | None = Header(default=None)) -> InternalPrincipal:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal credentials.")
        try:
            principal = verify_internal_token(authorization[7:], request.app.state.settings)
        except InternalAuthenticationError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal credentials.")
        if not set(required_scopes).issubset(principal.scopes):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Internal scope is not authorized.")
        return principal
    return dependency
