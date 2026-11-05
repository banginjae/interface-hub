package migrations

import (
	"embed"
	"io/fs"
	"sort"
	"strings"
)

//go:embed *.up.sql
var upSQL embed.FS

type File struct {
	Name string
	Body []byte
}

func Files() ([]File, error) {
	names, err := fs.ReadDir(upSQL, ".")
	if err != nil {
		return nil, err
	}
	out := make([]File, 0, len(names))
	for _, entry := range names {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".up.sql") {
			continue
		}
		body, err := upSQL.ReadFile(entry.Name())
		if err != nil {
			return nil, err
		}
		out = append(out, File{Name: entry.Name(), Body: body})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}
