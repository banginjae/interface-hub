import { LinkedErrorCodes } from "./ErrorCodePicker";
import { flattenFields, type ApiField, type SpecDocument, type SpecItem } from "./specModel";

export function SpecReader({ spec, item }: { spec: SpecDocument; item: SpecItem | null }) {
  return (
    <div className="spec-reader">
      <section>
        <h2>문서</h2>
        <p>{spec.title}</p>
        <p>Base URL {spec.overview.baseUrl || "없음"} · 인증 {spec.overview.auth?.type || "NONE"}</p>
        <FieldReadout title="공통 헤더" fields={spec.overview.commonHeaders ?? []} />
      </section>
      {!item ? <p>Endpoint를 선택하세요.</p> : <ItemReadout item={item} />}
    </div>
  );
}

function ItemReadout({ item }: { item: SpecItem }) {
  const payload = item.payload;
  return (
    <article>
      <h2>
        <span className={`method method-${(payload.method ?? "get").toLowerCase()}`}>{payload.method}</span>
        {payload.path}
      </h2>
      <p>{item.name}{item.summary ? ` · ${item.summary}` : ""}</p>
      <p>{payload.description || "설명이 없습니다."}</p>
      <p>인증 {payload.auth?.type || "NONE"}{payload.auth?.useDocumentAuth ? " · 문서 공통 인증" : ""}</p>
      <FieldReadout title="Headers" fields={payload.headers ?? []} />
      <FieldReadout title="Path Parameters" fields={payload.pathParams ?? []} />
      <FieldReadout title="Query Parameters" fields={payload.queryParams ?? []} />
      <ExampleReadout title="Request Body" fields={payload.requestBody?.fields ?? []} example={payload.requestBody?.example} mode={payload.requestBody?.exampleMode} />
      <LinkedErrorCodes codes={item.errorCodes} />
      {(payload.responses ?? []).map((response) => (
        <ExampleReadout
          key={`${response.status}-${response.name}`}
          title={`${response.status} ${response.name ?? ""}`}
          fields={response.fields ?? []}
          example={response.example}
          mode={response.exampleMode}
          note={response.description}
        />
      ))}
    </article>
  );
}

function FieldReadout({ title, fields }: { title: string; fields: ApiField[] }) {
  const rows = flattenFields(fields);
  return (
    <section>
      <h3>{title}</h3>
      {rows.length === 0 ? <p>없습니다.</p> : (
        <table>
          <thead>
            <tr><th>필드</th><th>타입</th><th>필수</th><th>설명</th><th>예시</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.path}>
                <td><code>{row.path}</code></td>
                <td>{row.type}</td>
                <td>{row.required ? "예" : "아니오"}</td>
                <td>{row.description}</td>
                <td>{row.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ExampleReadout({
  title,
  fields,
  example,
  mode,
  note,
}: {
  title: string;
  fields: ApiField[];
  example: unknown;
  mode?: string;
  note?: string;
}) {
  return (
    <section>
      <h3>{title}</h3>
      {note ? <p>{note}</p> : null}
      <FieldReadout title="필드" fields={fields} />
      <p className="mode-note">{mode === "MANUAL" ? "직접 입력 예시" : "자동 생성 예시"}</p>
      <pre>{JSON.stringify(example ?? {}, null, 2)}</pre>
    </section>
  );
}
