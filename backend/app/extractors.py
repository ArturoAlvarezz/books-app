"""Extractores de metadatos y portada para los formatos soportados."""
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET


_CONTAINER_NS = {
    "c": "urn:oasis:names:tc:opendocument:xmlns:container",
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
}


def _qn(ns: str, tag: str) -> str:
    return f"{{{_CONTAINER_NS[ns]}}}{tag}"


def _container_root_path(zf: zipfile.ZipFile) -> str | None:
    """Lee META-INF/container.xml para localizar el OPF rootfile."""
    try:
        raw = zf.read("META-INF/container.xml")
    except KeyError:
        return None
    root = ET.fromstring(raw)
    for rootfile in root.iter(_qn("c", "rootfile")):
        return rootfile.attrib.get("full-path")
    # Fallback sin namespace
    for rootfile in root.iter("rootfile"):
        return rootfile.attrib.get("full-path")
    return None


def _parse_opf(zf: zipfile.ZipFile, opf_path: str) -> ET.Element | None:
    try:
        raw = zf.read(opf_path)
    except KeyError:
        return None
    return ET.fromstring(raw)


def _manifest_items(opf: ET.Element) -> Iterable[tuple[str, dict]]:
    """Devuelve (id, props) para cada item del manifest."""
    for item in opf.iter(_qn("opf", "item")):
        yield item.attrib.get("id", ""), {
            "href": item.attrib.get("href", ""),
            "media_type": item.attrib.get("media-type", ""),
            "properties": item.attrib.get("properties", ""),
        }


def _resolve(opf_path: str, href: str) -> str:
    """Une opf_path + href respetando el directorio base."""
    base = Path(opf_path).parent
    return str(base / href)


def _pick_cover_image(opf: ET.Element, opf_path: str) -> str | None:
    items = list(_manifest_items(opf))
    # 1) cover-image explícito (EPUB3)
    for _id, item in items:
        if "cover-image" in item["properties"].lower() and item["href"]:
            return _resolve(opf_path, item["href"])
    # 2) cover por nombre de archivo
    for _id, item in items:
        href_lower = item["href"].lower()
        if "cover" in href_lower and item["media_type"].startswith("image/"):
            return _resolve(opf_path, item["href"])
    # 3) fallback: primera imagen del manifest
    for _id, item in items:
        if item["media_type"].startswith("image/") and item["href"]:
            return _resolve(opf_path, item["href"])
    return None


def extract_epub_cover(path: Path) -> tuple[str, bytes] | None:
    """Devuelve (media_type, bytes) de la portada, o None si no se encuentra."""
    try:
        with zipfile.ZipFile(path) as zf:
            opf_path = _container_root_path(zf)
            if not opf_path:
                return None
            opf = _parse_opf(zf, opf_path)
            if opf is None:
                return None
            cover_href = _pick_cover_image(opf, opf_path)
            if not cover_href:
                return None
            data = zf.read(cover_href)
    except (zipfile.BadZipFile, ET.ParseError, KeyError, OSError):
        return None

    ext = Path(cover_href).suffix.lower()
    media = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(ext)
    if not media:
        return None
    return media, data


def extract_epub_title(path: Path, fallback: str) -> str:
    """Lee el título del OPF; si falla usa el nombre del archivo."""
    try:
        with zipfile.ZipFile(path) as zf:
            opf_path = _container_root_path(zf)
            if not opf_path:
                return fallback
            opf = _parse_opf(zf, opf_path)
            if opf is None:
                return fallback
            for title in opf.iter(_qn("dc", "title")):
                text = (title.text or "").strip()
                if text:
                    return text
            for title in opf.iter(_qn("opf", "title")):
                text = (title.text or "").strip()
                if text:
                    return text
            for title in opf.iter("title"):
                text = (title.text or "").strip()
                if text:
                    return text
    except (zipfile.BadZipFile, ET.ParseError, KeyError, OSError):
        pass
    return fallback


_SLUG_RE = re.compile(r"[^a-zA-Z0-9_-]+")


def safe_filename(stem: str) -> str:
    """Genera un nombre de archivo seguro a partir de un stem arbitrario."""
    slug = _SLUG_RE.sub("-", stem).strip("-") or "cover"
    return slug[:120]