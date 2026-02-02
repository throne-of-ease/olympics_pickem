# Supabase Row Level Security (RLS) Policies

This document describes the RLS policies needed for the Olympics Pick'em app to work with client-side only architecture (no serverless functions).

## Overview

With RLS, security rules are enforced at the database level, allowing the app to work without serverless functions while maintaining data integrity and security.

## Required Tables

### `profiles` Table
```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
```

### `picks` Table
```sql
CREATE TABLE picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  team_a_score INTEGER NOT NULL,
  team_b_score INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, game_id)
);

-- Enable RLS
ALTER TABLE picks ENABLE ROW LEVEL SECURITY;
```

### `games_cache` Table (for game start times)
```sql
CREATE TABLE games_cache (
  game_id TEXT PRIMARY KEY,
  scheduled_at TIMESTAMPTZ NOT NULL,
  team_a_name TEXT,
  team_b_name TEXT,
  status TEXT DEFAULT 'scheduled',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (public read)
ALTER TABLE games_cache ENABLE ROW LEVEL SECURITY;
```

### `invites` Table
```sql
CREATE TABLE invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  invite_code TEXT UNIQUE NOT NULL,
  invited_by UUID REFERENCES auth.users(id),
  used BOOLEAN DEFAULT FALSE,
  used_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
```

## RLS Policies

### Profiles Policies

```sql
-- Anyone can view all profiles (for leaderboard)
CREATE POLICY "profiles_select_all"
ON profiles FOR SELECT
TO authenticated
USING (true);

-- Users can only update their own profile
CREATE POLICY "profiles_update_own"
ON profiles FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Profile is created via trigger on signup
CREATE POLICY "profiles_insert_own"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());
```

### Picks Policies

```sql
-- Users can always see their own picks
CREATE POLICY "picks_select_own"
ON picks FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can see others' picks ONLY after game has started
CREATE POLICY "picks_select_others_after_game_start"
ON picks FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM games_cache
    WHERE games_cache.game_id = picks.game_id
    AND games_cache.scheduled_at <= NOW()
  )
);

-- Users can insert their own picks ONLY before game starts
CREATE POLICY "picks_insert_before_game_start"
ON picks FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM games_cache
    WHERE games_cache.game_id = picks.game_id
    AND games_cache.scheduled_at > NOW()
  )
);

-- Users can update their own picks ONLY before game starts
CREATE POLICY "picks_update_before_game_start"
ON picks FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM games_cache
    WHERE games_cache.game_id = picks.game_id
    AND games_cache.scheduled_at > NOW()
  )
);

-- Users can delete their own picks ONLY before game starts
CREATE POLICY "picks_delete_before_game_start"
ON picks FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM games_cache
    WHERE games_cache.game_id = picks.game_id
    AND games_cache.scheduled_at > NOW()
  )
);
```

### Games Cache Policies

```sql
-- Anyone can read games cache (public schedule)
CREATE POLICY "games_cache_select_all"
ON games_cache FOR SELECT
TO authenticated, anon
USING (true);

-- Only admins can update games cache
CREATE POLICY "games_cache_admin_all"
ON games_cache FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.is_admin = true
  )
);
```

### Invites Policies

```sql
-- Anyone can validate an invite code (for signup)
CREATE POLICY "invites_select_valid"
ON invites FOR SELECT
TO anon, authenticated
USING (
  used = false
  AND expires_at > NOW()
);

-- Only admins can create invites
CREATE POLICY "invites_admin_insert"
ON invites FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.is_admin = true
  )
);

-- Only admins can delete unused invites
CREATE POLICY "invites_admin_delete"
ON invites FOR DELETE
TO authenticated
USING (
  used = false
  AND EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.is_admin = true
  )
);
```

## Helper Functions

### Validate Invite Code
```sql
CREATE OR REPLACE FUNCTION validate_invite_code(code TEXT)
RETURNS TABLE (valid BOOLEAN, email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    true AS valid,
    invites.email
  FROM invites
  WHERE invites.invite_code = code
    AND invites.used = false
    AND invites.expires_at > NOW();
END;
$$;
```

### Mark Invite Used
```sql
CREATE OR REPLACE FUNCTION mark_invite_used(code TEXT, user_uuid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE invites
  SET used = true, used_by = user_uuid
  WHERE invite_code = code;
END;
$$;
```

### Generate Invite Code
```sql
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$;
```

### Auto-create Profile on Signup
```sql
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION handle_new_user();
```

## Seeding Games Cache

The `games_cache` table should be populated with game schedule data. You can do this:

1. **Manually** via Supabase dashboard
2. **Via script** that fetches from ESPN API
3. **Via GitHub Action** that updates on a schedule

Example seed script:
```javascript
// scripts/seed-games-cache.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const games = [
  { game_id: '401845001', scheduled_at: '2026-02-11T12:00:00Z', team_a_name: 'Canada', team_b_name: 'Germany' },
  { game_id: '401845002', scheduled_at: '2026-02-11T16:00:00Z', team_a_name: 'USA', team_b_name: 'Finland' },
  // ... more games
];

async function seed() {
  const { error } = await supabase
    .from('games_cache')
    .upsert(games, { onConflict: 'game_id' });

  if (error) {
    console.error('Error seeding games:', error);
  } else {
    console.log('Games cache seeded successfully');
  }
}

seed();
```

## Security Notes

1. **Pick Visibility**: RLS ensures picks are hidden until game starts - this is enforced at database level, not bypassable from client
2. **Pick Deadlines**: RLS prevents submitting/updating picks after game starts
3. **User Isolation**: Users can only modify their own data
4. **Admin Functions**: Only users with `is_admin = true` can manage invites and games cache

## Testing RLS Policies

You can test policies in Supabase SQL Editor:
```sql
-- Test as a specific user
SET request.jwt.claims = '{"sub": "user-uuid-here"}';

-- Try to select picks (should only see own + started games)
SELECT * FROM picks;

-- Try to insert pick for started game (should fail)
INSERT INTO picks (user_id, game_id, team_a_score, team_b_score)
VALUES ('user-uuid', 'started-game-id', 3, 2);
```
