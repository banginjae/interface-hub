package auth

import "golang.org/x/crypto/bcrypt"

var dummyHash []byte

func init() {
	hash, err := bcrypt.GenerateFromPassword([]byte("missing-user-check"), bcrypt.DefaultCost)
	if err != nil {
		panic(err)
	}
	dummyHash = hash
}

func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func CheckPassword(hash, password string) bool {
	target := []byte(hash)
	if hash == "" {
		target = dummyHash
	}
	return bcrypt.CompareHashAndPassword(target, []byte(password)) == nil && hash != ""
}
