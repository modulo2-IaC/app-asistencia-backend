import * as ExcelJS from 'exceljs';
import { isBlankCell, cellText, normalizeLabel } from './cell-value';
import { ImportFile, ImportIssue } from './import-issue';
import { inspectZipArchive } from './zip-guard';

export interface ColumnSpec<K extends string> {
  key: K;
  /** Label shown to the admin (matches the downloadable template). */
  label: string;
  /** Accepted header spellings, already normalized with normalizeLabel. */
  aliases: string[];
}

export interface SheetRow<K extends string> {
  row: number;
  values: Record<K, unknown>;
}

export interface SheetReadResult<K extends string> {
  rows: SheetRow<K>[];
  issues: ImportIssue[];
}

const FILE_LABEL: Record<ImportFile, string> = {
  students: 'estudiantes',
  schedules: 'fechas',
};

/**
 * Streams the first worksheet of an .xlsx file and maps each data row to the
 * requested columns. Reading stops as soon as maxRows is exceeded, so oversized
 * files never get fully loaded in memory.
 */
export async function readSheet<K extends string>(
  buffer: Buffer,
  file: ImportFile,
  columns: ColumnSpec<K>[],
  maxRows: number,
): Promise<SheetReadResult<K>> {
  const fileIssue = (message: string): SheetReadResult<K> => ({
    rows: [],
    issues: [{ file, row: null, column: null, message }],
  });

  const zipProblem = inspectZipArchive(buffer);
  if (zipProblem) {
    return fileIssue(
      zipProblem === 'not-zip'
        ? `El archivo de ${FILE_LABEL[file]} no es un Excel (.xlsx) válido.`
        : `El archivo de ${FILE_LABEL[file]} es demasiado grande o tiene un formato no admitido.`,
    );
  }

  const rows: SheetRow<K>[] = [];
  const issues: ImportIssue[] = [];
  let columnIndexes: Map<K, number> | null = null;
  let exceeded = false;

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount === 0) {
      return fileIssue(
        `El archivo de ${FILE_LABEL[file]} está vacío. Usa la plantilla.`,
      );
    }

    worksheet.eachRow((row) => {
      const values = row.values as unknown[];
      if (!columnIndexes) {
        const header = resolveHeader(values, columns);
        if (header.missing.length > 0 || header.duplicated.length > 0) {
          const problems = [
            header.missing.length > 0
              ? `faltan las columnas: ${header.missing.join(', ')}`
              : '',
            header.duplicated.length > 0
              ? `columnas repetidas: ${header.duplicated.join(', ')}`
              : '',
          ].filter(Boolean);
          issues.push({
            file,
            row: row.number,
            column: null,
            message: `Encabezados inválidos en la fila ${row.number}: ${problems.join('; ')}. Usa la plantilla.`,
          });
          columnIndexes = header.indexes; // prevents re-evaluating header
          return false;
        }
        columnIndexes = header.indexes;
        return;
      }

      if (issues.length > 0) return false;

      const mapped = {} as Record<K, unknown>;
      let blank = true;
      for (const [key, index] of columnIndexes) {
        mapped[key] = values[index] ?? null;
        if (!isBlankCell(mapped[key])) blank = false;
      }
      if (blank) return;

      if (rows.length >= maxRows) {
        exceeded = true;
        return false;
      }
      rows.push({ row: row.number, values: mapped });
    });
  } catch {
    return fileIssue(
      `No se pudo leer el archivo de ${FILE_LABEL[file]}. Verifica que sea un Excel (.xlsx) válido y no esté dañado.`,
    );
  }

  if (!columnIndexes) {
    return fileIssue(
      `El archivo de ${FILE_LABEL[file]} está vacío. Usa la plantilla.`,
    );
  }
  if (exceeded) {
    issues.push({
      file,
      row: null,
      column: null,
      message: `El archivo de ${FILE_LABEL[file]} supera el máximo de ${maxRows} filas.`,
    });
  } else if (rows.length === 0) {
    issues.push({
      file,
      row: null,
      column: null,
      message: `El archivo de ${FILE_LABEL[file]} no tiene filas con datos.`,
    });
  }
  return { rows, issues };
}

function resolveHeader<K extends string>(
  values: unknown[],
  columns: ColumnSpec<K>[],
) {
  const indexes = new Map<K, number>();
  const duplicated: string[] = [];
  values.forEach((value, index) => {
    const text = cellText(value);
    if (!text) return;
    const normalized = normalizeLabel(text);
    const column = columns.find((spec) => spec.aliases.includes(normalized));
    if (!column) return;
    if (indexes.has(column.key)) {
      if (!duplicated.includes(column.label)) duplicated.push(column.label);
      return;
    }
    indexes.set(column.key, index);
  });
  const missing = columns
    .filter((column) => !indexes.has(column.key))
    .map((column) => column.label);
  return { indexes, missing, duplicated };
}
