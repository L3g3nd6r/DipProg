-- data:image/jpeg;base64,... и длинные URL не помещаются в VARCHAR(512)
ALTER TABLE users
  ALTER COLUMN avatar_url TYPE TEXT;
