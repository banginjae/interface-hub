package handler_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"interface-hub/internal/config"
	"interface-hub/internal/repository"
	"interface-hub/internal/service"
)

func TestDeviceProtocolOnMariaDB(t *testing.T) {
	cfg, err := config.Load("../../config/config.yaml")
	if err != nil {
		t.Skip("local config is not available")
	}
	if (cfg.Database.Host != "127.0.0.1" && cfg.Database.Host != "localhost") || cfg.Database.Name != "interface_hub" {
		t.Fatal("refusing to run outside local interface_hub")
	}
	gdb, err := repository.Open(cfg.Database)
	if err != nil {
		t.Fatal("database")
	}
	suffix := randomToken(t)
	t.Cleanup(func() { cleanupSpecFixture(t, gdb, suffix) })
	password := "dev-" + randomToken(t)
	accounts := service.NewAccountService(repository.NewUserRepository(gdb))
	creator := makeUser(t, accounts, "s4c"+suffix, "장비생성", "MEMBER", password)
	reader := makeUser(t, accounts, "s4r"+suffix, "장비조회", "MEMBER", password)
	outsider := makeUser(t, accounts, "s4o"+suffix, "장비외부", "MEMBER", password)
	server := newProjectServer(t, gdb)
	creatorToken := loginEmployee(t, server.URL, creator.EmployeeNo, password)
	readerToken := loginEmployee(t, server.URL, reader.EmployeeNo, password)
	outsiderToken := loginEmployee(t, server.URL, outsider.EmployeeNo, password)
	createdProject := sendJSON(t, http.MethodPost, server.URL+"/api/projects", creatorToken, map[string]string{
		"title": "장비 검증 " + suffix, "description": "device-" + suffix,
	})
	if createdProject.StatusCode != http.StatusCreated {
		t.Fatalf("project %d", createdProject.StatusCode)
	}
	var project struct {
		ID      uint64 `json:"id"`
		Version uint   `json:"version"`
	}
	if err := json.Unmarshal([]byte(readBody(t, createdProject)), &project); err != nil {
		t.Fatal(err)
	}
	base := projectURL(server.URL, project.ID)
	if sendJSON(t, http.MethodPost, base+"/members", creatorToken, map[string]string{
		"employeeNo": reader.EmployeeNo, "permission": "READ",
	}).StatusCode != http.StatusCreated {
		t.Fatal("member")
	}
	for _, kind := range []string{"API", "MQTT", "WEBSOCKET"} {
		created := sendJSON(t, http.MethodPost, base+"/specs", creatorToken, map[string]string{"kind": kind, "title": kind})
		if created.StatusCode != http.StatusCreated {
			t.Fatalf("spec %s %d", kind, created.StatusCode)
		}
	}
	general := createGeneralDoc(t, base+"/general-docs", creatorToken, "설치 메모", "FW", "유지", "최초 작성")

	created := sendJSON(t, http.MethodPost, base+"/specs", creatorToken, map[string]string{"kind": "DEVICE_PROTOCOL", "title": "장비 프로토콜"})
	if created.StatusCode != http.StatusCreated || fieldOf(t, readBody(t, created), "version") != "1" {
		t.Fatalf("create %d", created.StatusCode)
	}
	docURL := base + "/specs/DEVICE_PROTOCOL"
	head := deviceField("commandId", "integer", "16", 0, 1, "BIG", "UINT8")
	speed := deviceField("speed", "integer", "10", 1, 2, "BIG", "UINT16")
	first := sendJSON(t, http.MethodPost, docURL+"/items", creatorToken, itemBody(1, "시작 명령", deviceCommand("0x10", "REQUEST", "10 00 0a", nil, head, speed)))
	firstBody := readBody(t, first)
	if first.StatusCode != http.StatusCreated || fieldOf(t, firstBody, "version") != "2" {
		t.Fatalf("command %d %s", first.StatusCode, firstBody)
	}
	var createdItem struct {
		Version uint   `json:"version"`
		ItemUID string `json:"itemUid"`
	}
	if err := json.Unmarshal([]byte(firstBody), &createdItem); err != nil {
		t.Fatal(err)
	}
	overlap := sendJSON(t, http.MethodPost, docURL+"/items", creatorToken, itemBody(createdItem.Version, "겹침", deviceCommand("0x11", "REQUEST", "", nil, deviceField("a", "integer", "1", 0, 2, "BIG", "UINT16"), deviceField("b", "integer", "1", 1, 1, "BIG", "UINT8"))))
	if overlap.StatusCode != http.StatusBadRequest {
		t.Fatalf("overlap %d", overlap.StatusCode)
	}
	badLength := sendJSON(t, http.MethodPost, docURL+"/items", creatorToken, itemBody(createdItem.Version, "길이", deviceCommand("0x12", "REQUEST", "", nil, deviceField("a", "integer", "1", 0, 0, "BIG", "UINT8"))))
	if badLength.StatusCode != http.StatusBadRequest {
		t.Fatalf("length %d", badLength.StatusCode)
	}
	second := sendJSON(t, http.MethodPost, docURL+"/items", creatorToken, itemBody(createdItem.Version, "시작 응답", deviceCommand("0x90", "RESPONSE", "90", &createdItem.ItemUID, deviceField("result", "integer", "1", 0, 1, "LITTLE", "INT8"))))
	secondBody := readBody(t, second)
	if second.StatusCode != http.StatusCreated {
		t.Fatalf("response %d %s", second.StatusCode, secondBody)
	}
	var responseItem struct {
		Version uint   `json:"version"`
		ItemUID string `json:"itemUid"`
	}
	if err := json.Unmarshal([]byte(secondBody), &responseItem); err != nil || responseItem.Version != 3 {
		t.Fatal(secondBody)
	}
	third := sendJSON(t, http.MethodPost, docURL+"/items", creatorToken, itemBody(responseItem.Version, "상태 이벤트", deviceCommand("0x20", "EVENT", "", nil, deviceField("state", "integer", "1", 0, 1, "BIG", "UINT8"))))
	if third.StatusCode != http.StatusCreated || fieldOf(t, readBody(t, third), "version") != "4" {
		t.Fatalf("event %d", third.StatusCode)
	}
	stored := readBody(t, sendJSON(t, http.MethodGet, docURL, readerToken, nil))
	if !strings.Contains(stored, `"commandId":"0x10"`) || !strings.Contains(stored, `"exampleHex":"10 00 0A"`) || !strings.Contains(stored, `"endian":"LITTLE"`) {
		t.Fatal("round trip")
	}
	updatedSpeed := deviceField("speed", "integer", "12", 1, 2, "BIG", "UINT16")
	updated := sendJSON(t, http.MethodPut, docURL+"/items/"+createdItem.ItemUID, creatorToken, itemBody(4, "속도 수정", deviceCommand("0x10", "REQUEST", "10 00 0C", &responseItem.ItemUID, head, updatedSpeed)))
	if updated.StatusCode != http.StatusOK || fieldOf(t, readBody(t, updated), "version") != "5" {
		t.Fatalf("update %d", updated.StatusCode)
	}
	stale := sendJSON(t, http.MethodPut, docURL+"/items/"+createdItem.ItemUID, creatorToken, itemBody(4, "늦은 저장", deviceCommand("0x10", "REQUEST", "FF", nil, head)))
	staleBody := readBody(t, stale)
	if stale.StatusCode != http.StatusConflict || codeIn(t, staleBody) != "DOCUMENT_VERSION_CONFLICT" || fieldOf(t, staleBody, "currentVersion") != "5" {
		t.Fatalf("conflict %d %s", stale.StatusCode, staleBody)
	}
	if strings.Contains(readBody(t, sendJSON(t, http.MethodGet, docURL, readerToken, nil)), `"exampleHex":"FF"`) {
		t.Fatal("stale hex saved")
	}
	markdown := sendJSON(t, http.MethodGet, docURL+"/markdown", readerToken, nil)
	markdownBody := readBody(t, markdown)
	if markdown.StatusCode != http.StatusOK || !strings.Contains(markdownBody, "Command ID: 0x10") || !strings.Contains(markdownBody, "10 00 0C") || !strings.Contains(markdownBody, "UINT16") {
		t.Fatal("markdown")
	}
	if getSpec(t, docURL, readerToken).Version != 5 {
		t.Fatal("markdown changed version")
	}
	for _, kind := range []string{"API", "MQTT", "WEBSOCKET"} {
		if getSpec(t, base+"/specs/"+kind, creatorToken).Version != 1 {
			t.Fatalf("%s version changed", kind)
		}
	}
	if getGeneral(t, base+"/general-docs/"+u64(general.ID), creatorToken).Version != 1 {
		t.Fatal("general version changed")
	}
	if sendJSON(t, http.MethodPost, docURL+"/items", readerToken, itemBody(5, "조회자", deviceCommand("1", "EVENT", "", nil))).StatusCode != http.StatusForbidden {
		t.Fatal("reader write")
	}
	if sendJSON(t, http.MethodGet, docURL, outsiderToken, nil).StatusCode != http.StatusForbidden {
		t.Fatal("outsider")
	}
	archived := sendJSON(t, http.MethodPut, base, creatorToken, map[string]any{
		"version": project.Version, "title": "장비 검증 " + suffix, "description": "device-" + suffix, "status": "ARCHIVED",
	})
	if archived.StatusCode != http.StatusOK {
		t.Fatalf("archive %d", archived.StatusCode)
	}
	if codeIn(t, readBody(t, sendJSON(t, http.MethodPut, docURL+"/items/"+createdItem.ItemUID, creatorToken, itemBody(5, "보관", deviceCommand("0x10", "REQUEST", "", nil, head))))) != "PROJECT_ARCHIVED" {
		t.Fatal("archived write")
	}
	if sendJSON(t, http.MethodGet, docURL+"/markdown", readerToken, nil).StatusCode != http.StatusOK {
		t.Fatal("archived markdown")
	}
}

func deviceCommand(commandID, direction, hex string, related *string, fields ...map[string]any) map[string]any {
	if fields == nil {
		fields = []map[string]any{}
	}
	return map[string]any{
		"commandId": commandID, "direction": direction, "description": "설명",
		"fields": fields, "exampleHex": hex, "exampleMode": "AUTO", "exampleJson": nil, "relatedItemUid": related,
	}
}

func deviceField(name, fieldType, example string, offset, length int, endian, encoding string) map[string]any {
	var byteLength any = length
	if length == 0 {
		byteLength = 0
	}
	return map[string]any{
		"name": name, "type": fieldType, "required": true, "nullable": false,
		"description": name, "example": example, "format": "", "enum": []any{},
		"children": []any{}, "arrayItem": nil,
		"byteOffset": offset, "byteLength": byteLength, "endian": endian, "encoding": encoding,
		"lengthMode": "FIXED", "bitOffset": nil, "bitLength": nil,
	}
}
