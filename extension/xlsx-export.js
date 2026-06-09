(function () {
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  function xmlEscape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function columnName(index) {
    let name = "";
    let n = index + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function sheetXml(rows) {
    const body = rows
      .map((row, rowIndex) => {
        const cells = row
          .map((cell, colIndex) => {
            const ref = `${columnName(colIndex)}${rowIndex + 1}`;
            return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
          })
          .join("");
        return `<row r="${rowIndex + 1}">${cells}</row>`;
      })
      .join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${body}</sheetData>
</worksheet>`;
  }

  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="未提交海报" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
  };

  let crcTable;
  function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  }

  function crc32(bytes) {
    crcTable ||= makeCrcTable();
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeUint16(out, value) {
    out.push(value & 0xff, (value >>> 8) & 0xff);
  }

  function writeUint32(out, value) {
    out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }

  function bytesOf(text) {
    return new TextEncoder().encode(text);
  }

  function zip(fileMap) {
    const out = [];
    const central = [];
    let offset = 0;

    Object.entries(fileMap).forEach(([name, content]) => {
      const nameBytes = bytesOf(name);
      const data = bytesOf(content);
      const crc = crc32(data);
      const localOffset = offset;

      writeUint32(out, 0x04034b50);
      writeUint16(out, 20);
      writeUint16(out, 0);
      writeUint16(out, 0);
      writeUint16(out, 0);
      writeUint16(out, 0);
      writeUint32(out, crc);
      writeUint32(out, data.length);
      writeUint32(out, data.length);
      writeUint16(out, nameBytes.length);
      writeUint16(out, 0);
      out.push(...nameBytes, ...data);
      offset = out.length;

      writeUint32(central, 0x02014b50);
      writeUint16(central, 20);
      writeUint16(central, 20);
      writeUint16(central, 0);
      writeUint16(central, 0);
      writeUint16(central, 0);
      writeUint16(central, 0);
      writeUint32(central, crc);
      writeUint32(central, data.length);
      writeUint32(central, data.length);
      writeUint16(central, nameBytes.length);
      writeUint16(central, 0);
      writeUint16(central, 0);
      writeUint16(central, 0);
      writeUint16(central, 0);
      writeUint32(central, 0);
      writeUint32(central, localOffset);
      central.push(...nameBytes);
    });

    const centralOffset = out.length;
    out.push(...central);
    writeUint32(out, 0x06054b50);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint16(out, Object.keys(fileMap).length);
    writeUint16(out, Object.keys(fileMap).length);
    writeUint32(out, central.length);
    writeUint32(out, centralOffset);
    writeUint16(out, 0);

    return new Uint8Array(out);
  }

  function createNoPosterXlsxBlob(records) {
    const headers = ["报名ID", "团队名称", "学生姓名", "学校全称", "指导教师"];
    const rows = [
      headers,
      ...records.map((item) => [
        item.registrationId || "",
        item.teamName || "",
        item.studentName || "",
        item.schoolName || "",
        item.teacherName || ""
      ])
    ];
    const fileMap = {
      ...files,
      "xl/worksheets/sheet1.xml": sheetXml(rows)
    };
    return new Blob([zip(fileMap)], { type: XLSX_MIME });
  }

  function downloadNoPosterXlsx(records, filename) {
    const blob = createNoPosterXlsxBlob(records);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `未提交海报名单_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.NoPosterXlsx = {
    createNoPosterXlsxBlob,
    downloadNoPosterXlsx
  };
})();
