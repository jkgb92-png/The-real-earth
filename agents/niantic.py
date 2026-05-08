from dataclasses import dataclass, asdict
from typing import List, Optional, Dict, Any
import json
import sys

@dataclass
class Location:
    lat: float
    lng: float
    alt: Optional[float] = None

@dataclass
class NianticData:
    id: str
    name: str
    description: Optional[str]
    type: str
    location: Location
    tags: Optional[List[str]] = None
    properties: Optional[Dict[str, Any]] = None
    updatedAt: Optional[str] = None

niantic_data: List[NianticData] = [
    NianticData(
        id="niantic-0001",
        name="Old Town Fountain",
        description="A historic fountain popular with visitors.",
        type="pokestop",
        location=Location(lat=37.7749, lng=-122.4194),
        tags=["historic", "water-feature"],
        properties={"verified": True, "photos": 3},
        updatedAt="2026-05-08T18:29:31Z"
    ),
    NianticData(
        id="niantic-0002",
        name="Riverside Gym",
        description="Friendly community gym with weekly events.",
        type="gym",
        location=Location(lat=37.7765, lng=-122.4172),
        tags=["gym", "events"],
        properties={"eventSchedule": [{"name": "Raid Sunday", "day": "sunday", "time": "10:00"}]},
        updatedAt="2026-05-08T18:29:31Z"
    )
]


def to_geojson_feature(item: NianticData) -> Dict[str, Any]:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [item.location.lng, item.location.lat]},
        "properties": {k: v for k, v in asdict(item).items() if k != 'location'}
    }


def to_feature_collection(items: List[NianticData]) -> Dict[str, Any]:
    return {"type": "FeatureCollection", "features": [to_geojson_feature(i) for i in items]}


if __name__ == '__main__':
    out_geojson = to_feature_collection(niantic_data)
    with open('agents/niantic.geojson', 'w', encoding='utf8') as f:
        json.dump(out_geojson, f, indent=2)
    with open('agents/niantic.json', 'w', encoding='utf8') as f:
        json.dump([asdict(d) for d in niantic_data], f, indent=2)
    print('Wrote agents/niantic.geojson and agents/niantic.json')
