#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


STEP_TO_SOLFEGE = {
    "C": "do",
    "D": "re",
    "E": "mi",
    "F": "fa",
    "G": "sol",
    "A": "la",
    "B": "si",
}


def pitch_to_string(step: str, alter: str | None, octave: str | None) -> str:
    accidental = ""
    if alter == "1":
        accidental = "#"
    elif alter == "-1":
        accidental = "b"
    return f"{step}{accidental}{octave or ''}"


def pitch_to_solfege(step: str, alter: str | None) -> str:
    base = STEP_TO_SOLFEGE.get(step, step.lower())
    if alter == "1":
        return f"{base}#"
    if alter == "-1":
        return f"{base}b"
    return base


def read_score_xml(path: Path) -> bytes:
    with zipfile.ZipFile(path) as zf:
        return zf.read("score.xml")


def extract_part(root: ET.Element, part_id: str) -> ET.Element:
    part = root.find(f"./part[@id='{part_id}']")
    if part is None:
        raise SystemExit(f"Part {part_id!r} not found")
    return part


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mxl", type=Path)
    parser.add_argument("--part", default="P1")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    xml_bytes = read_score_xml(args.mxl)
    root = ET.fromstring(xml_bytes)
    part = extract_part(root, args.part)

    title = root.findtext("./work/work-title") or root.findtext("./movement-title") or args.mxl.stem
    tempo = None
    divisions = 1
    notes: list[dict[str, object]] = []
    absolute_beats = 0.0

    for measure in part.findall("measure"):
        measure_no = int(measure.attrib.get("number", "0"))
        attrs = measure.find("attributes")
        if attrs is not None and attrs.find("divisions") is not None:
            divisions = int(attrs.findtext("divisions", "1"))

        if tempo is None:
            sound = measure.find("sound")
            if sound is not None and sound.attrib.get("tempo"):
                tempo = float(sound.attrib["tempo"])

        beat_pos = 0.0
        note_index = 0
        for elem in measure:
            if elem.tag == "backup":
                beat_pos -= int(elem.findtext("duration", "0")) / divisions
                continue
            if elem.tag == "forward":
                beat_pos += int(elem.findtext("duration", "0")) / divisions
                continue
            if elem.tag != "note":
                continue

            dur_beats = int(elem.findtext("duration", "0")) / divisions
            start_beat = beat_pos

            if elem.find("rest") is not None:
                beat_pos += dur_beats
                continue

            pitch = elem.find("pitch")
            if pitch is None:
                beat_pos += dur_beats
                continue

            step = pitch.findtext("step", "")
            alter = pitch.findtext("alter")
            octave = pitch.findtext("octave")
            note = {
                "id": f"{args.part}-m{measure_no}-n{note_index}",
                "measure": measure_no,
                "beat": round(start_beat + 1, 3),
                "absoluteBeat": round(absolute_beats + start_beat + 1, 3),
                "durationBeats": dur_beats,
                "startSeconds": round(((absolute_beats + start_beat) * 60 / tempo), 4) if tempo else None,
                "durationSeconds": round((dur_beats * 60 / tempo), 4) if tempo else None,
                "pitch": pitch_to_string(step, alter, octave),
                "solfege": pitch_to_solfege(step, alter),
                "noteType": elem.findtext("type"),
                "bbox": {
                    "x": float(elem.attrib.get("default-x", "0")),
                    "y": float(elem.attrib.get("default-y", "0")),
                },
            }
            notes.append(note)
            note_index += 1
            beat_pos += dur_beats
        absolute_beats += beat_pos

    payload = {
        "title": title,
        "partId": args.part,
        "tempo": tempo,
        "sourceFile": str(args.mxl),
        "noteCount": len(notes),
        "notes": notes,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
