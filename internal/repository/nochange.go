package repository

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"strings"

	"interface-hub/internal/model"
)

// errNoChange lets a mutation report that the stored row already holds the requested values,
// so the caller commits nothing and keeps the current version and revision history.
var errNoChange = errors.New("no change")

// requireReason enforces the change reason only for writes that actually change data.
func requireReason(reason string) error {
	if strings.TrimSpace(reason) == "" {
		return model.ErrSpecInput
	}
	return nil
}

// sameJSON compares decoded JSON values, so key order and formatting do not count as changes.
func sameJSON(left, right string) bool {
	a, errA := decodeJSON(left)
	b, errB := decodeJSON(right)
	if errA != nil || errB != nil {
		return false
	}
	return reflect.DeepEqual(a, b)
}

func decodeJSON(raw string) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader([]byte(raw)))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}

// sameIDSet treats linked ids as a set; the link table has no order.
func sameIDSet(left, right []uint64) bool {
	a := slices.Clone(left)
	b := slices.Clone(right)
	slices.Sort(a)
	slices.Sort(b)
	return slices.Equal(slices.Compact(a), slices.Compact(b))
}
