import fs from "node:fs/promises";
import path from "node:path";
import formatXml from "xml-formatter";
import { sha256 } from "../utils/hash";
import { sanitizePathSegment, toPosixPath } from "../utils/path";

export interface XmlStoreResult {
  absolutePath: string;
  relativePath: string;
  exists: boolean;
  written: boolean;
  rawHash: string;
  prettyHash: string;
  prettyXml: string;
}

export interface SaveIndiceParams {
  idNorma: string;
  indiceFechaRaw: string | null;
  rawXml: string;
  dryRun: boolean;
}

export interface SaveVersionParams {
  idNorma: string;
  idBloque: string;
  fechaVigenciaRaw: string | null;
  fechaPublicacionRaw: string | null;
  rawXml: string;
  dryRun: boolean;
}

function normalizeDateToken(raw: string | null | undefined): string {
  if (!raw) {
    return "NA";
  }
  return raw.replace(/[^0-9TZ]/g, "") || "NA";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function prettyPrintXml(xml: string): string {
  try {
    return formatXml(xml, {
      indentation: "  ",
      collapseContent: false,
      lineSeparator: "\n",
      whiteSpaceAtEndOfSelfclosingTag: true,
    });
  } catch {
    // If formatter fails for a malformed fragment, keep original content.
    return xml;
  }
}

async function writeFileIfMissing(filePath: string, content: string, dryRun: boolean): Promise<boolean> {
  const exists = await fileExists(filePath);
  if (exists || dryRun) {
    return false;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    const handle = await fs.open(filePath, "wx");
    try {
      await handle.writeFile(content, { encoding: "utf8" });
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

export class FsStore {
  private readonly rootAbsolute: string;

  constructor(storageRoot: string) {
    this.rootAbsolute = path.resolve(storageRoot);
  }

  private toRelativePath(absolutePath: string): string {
    return toPosixPath(path.relative(this.rootAbsolute, absolutePath));
  }

  private buildIndicePath(idNorma: string, indiceFechaRaw: string | null, rawHash: string): string {
    const safeNorma = sanitizePathSegment(idNorma);
    const fileToken = normalizeDateToken(indiceFechaRaw) || rawHash.slice(0, 8);
    const filename = `${fileToken}__${rawHash.slice(0, 8)}.xml`;

    return path.join(this.rootAbsolute, "normas", safeNorma, "indice", filename);
  }

  private buildVersionPath(
    idNorma: string,
    idBloque: string,
    fechaVigenciaRaw: string | null,
    fechaPublicacionRaw: string | null,
    rawHash: string,
  ): string {
    const safeNorma = sanitizePathSegment(idNorma);
    const safeBloque = sanitizePathSegment(idBloque);
    const vigencia = normalizeDateToken(fechaVigenciaRaw);
    const publicacion = normalizeDateToken(fechaPublicacionRaw);
    const filename = `${vigencia}__${publicacion || "NA"}__${rawHash.slice(0, 8)}.xml`;

    return path.join(
      this.rootAbsolute,
      "normas",
      safeNorma,
      "bloques",
      safeBloque,
      "versions",
      filename,
    );
  }

  async saveIndice(params: SaveIndiceParams): Promise<XmlStoreResult> {
    const rawHash = sha256(params.rawXml);
    const prettyXml = prettyPrintXml(params.rawXml);
    const prettyHash = sha256(prettyXml);

    const absolutePath = this.buildIndicePath(params.idNorma, params.indiceFechaRaw, rawHash);
    const exists = await fileExists(absolutePath);
    const written = exists ? false : await writeFileIfMissing(absolutePath, prettyXml, params.dryRun);

    return {
      absolutePath,
      relativePath: this.toRelativePath(absolutePath),
      exists,
      written,
      rawHash,
      prettyHash,
      prettyXml,
    };
  }

  async saveBloqueVersion(params: SaveVersionParams): Promise<XmlStoreResult> {
    const rawHash = sha256(params.rawXml);
    const prettyXml = prettyPrintXml(params.rawXml);
    const prettyHash = sha256(prettyXml);

    const absolutePath = this.buildVersionPath(
      params.idNorma,
      params.idBloque,
      params.fechaVigenciaRaw,
      params.fechaPublicacionRaw,
      rawHash,
    );

    const exists = await fileExists(absolutePath);
    const written = exists ? false : await writeFileIfMissing(absolutePath, prettyXml, params.dryRun);

    return {
      absolutePath,
      relativePath: this.toRelativePath(absolutePath),
      exists,
      written,
      rawHash,
      prettyHash,
      prettyXml,
    };
  }

  async saveRawSnapshot(
    idNorma: string,
    idBloque: string,
    rawXml: string,
    fetchTimestamp: string,
    dryRun: boolean,
  ): Promise<XmlStoreResult> {
    const rawHash = sha256(rawXml);
    const prettyXml = prettyPrintXml(rawXml);
    const prettyHash = sha256(prettyXml);

    const absolutePath = path.join(
      this.rootAbsolute,
      "normas",
      sanitizePathSegment(idNorma),
      "bloques",
      sanitizePathSegment(idBloque),
      "raw",
      `${sanitizePathSegment(fetchTimestamp)}.xml`,
    );

    const exists = await fileExists(absolutePath);
    const written = exists ? false : await writeFileIfMissing(absolutePath, prettyXml, dryRun);

    return {
      absolutePath,
      relativePath: this.toRelativePath(absolutePath),
      exists,
      written,
      rawHash,
      prettyHash,
      prettyXml,
    };
  }
}
