import { describe, expect, it } from "vitest";
import {
  buildVigenciaAsOfFilter,
  buildVigenciaHastaIntervals,
  isDateWithinVigenciaRange,
} from "../src/utils/vigencia";

describe("vigencia intervals", () => {
  it("computes [desde, hasta) intervals without subtracting days", () => {
    const docs = [
      { _id: "u-2020", fecha_vigencia_desde: new Date("2020-01-01T00:00:00.000Z") },
      { _id: "u-2022", fecha_vigencia_desde: new Date("2022-06-01T00:00:00.000Z") },
      { _id: "u-2024", fecha_vigencia_desde: new Date("2024-01-01T00:00:00.000Z") },
    ];

    const intervals = buildVigenciaHastaIntervals(docs);
    const byId = new Map(intervals.map((item) => [item._id, item.fecha_vigencia_hasta]));

    expect(byId.get("u-2020")?.toISOString()).toBe("2022-06-01T00:00:00.000Z");
    expect(byId.get("u-2022")?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(byId.get("u-2024")).toBeNull();
  });
});

describe("vigencia as-of filter", () => {
  it("selects the unit whose interval contains the as-of date", () => {
    const asOf = new Date("2023-01-01T00:00:00.000Z");
    const filter = buildVigenciaAsOfFilter(asOf);

    expect(filter).toEqual({
      "metadata.fecha_vigencia_desde": { $lte: asOf },
      $or: [
        { "metadata.fecha_vigencia_hasta": null },
        { "metadata.fecha_vigencia_hasta": { $gt: asOf } },
      ],
    });

    const docs = [
      {
        _id: "u-2020",
        metadata: {
          fecha_vigencia_desde: new Date("2020-01-01T00:00:00.000Z"),
          fecha_vigencia_hasta: new Date("2022-06-01T00:00:00.000Z"),
        },
      },
      {
        _id: "u-2022",
        metadata: {
          fecha_vigencia_desde: new Date("2022-06-01T00:00:00.000Z"),
          fecha_vigencia_hasta: new Date("2024-01-01T00:00:00.000Z"),
        },
      },
      {
        _id: "u-2024",
        metadata: {
          fecha_vigencia_desde: new Date("2024-01-01T00:00:00.000Z"),
          fecha_vigencia_hasta: null,
        },
      },
    ];

    const active = docs.filter((doc) =>
      isDateWithinVigenciaRange(asOf, {
        fecha_vigencia_desde: doc.metadata.fecha_vigencia_desde,
        fecha_vigencia_hasta: doc.metadata.fecha_vigencia_hasta,
      }),
    );

    expect(active).toHaveLength(1);
    expect(active[0]?._id).toBe("u-2022");
  });
});
