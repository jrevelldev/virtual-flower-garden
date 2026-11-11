-- Migration 001: The Living Garden Initial Schema
-- Enforces separation between private submissions and public flower projections,
-- handles atomic slot allocation, and provides strict Row Level Security (RLS).

-- 1. Submissions Table (Private submission data)
CREATE TABLE IF NOT EXISTS public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT 'A visitor',
  message TEXT NOT NULL,
  design JSONB NOT NULL,
  generator_version INTEGER NOT NULL DEFAULT 1,
  seed BIGINT NOT NULL,
  slot_index INTEGER UNIQUE NOT NULL,
  placement JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'pending', 'hidden')),
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Public Flowers Table (Public projection viewable by any gallery or mobile visitor)
CREATE TABLE IF NOT EXISTS public.public_flowers (
  id UUID PRIMARY KEY REFERENCES public.submissions(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  message TEXT NOT NULL,
  design JSONB NOT NULL,
  generator_version INTEGER NOT NULL DEFAULT 1,
  seed BIGINT NOT NULL,
  slot_index INTEGER UNIQUE NOT NULL,
  placement JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'hidden')),
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ NOT NULL
);

-- 3. Installation Settings Table
CREATE TABLE IF NOT EXISTS public.installation_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  approve_before_planting BOOLEAN NOT NULL DEFAULT FALSE,
  reveal_hold_seconds INTEGER NOT NULL DEFAULT 6 CHECK (reveal_hold_seconds BETWEEN 2 AND 30),
  catch_up_limit INTEGER NOT NULL DEFAULT 20 CHECK (catch_up_limit BETWEEN 1 AND 100),
  visitor_url TEXT NOT NULL DEFAULT 'https://thelivinggarden.art/create',
  submissions_paused BOOLEAN NOT NULL DEFAULT FALSE,
  quality_preset TEXT NOT NULL DEFAULT 'high' CHECK (quality_preset IN ('high', 'medium', 'low')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Seed default settings if not exists
INSERT INTO public.installation_settings (id, approve_before_planting, reveal_hold_seconds, catch_up_limit, submissions_paused)
VALUES (1, FALSE, 6, 20, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Enable Row Level Security (RLS)
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_flowers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installation_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies:
-- Public can read approved public flowers
CREATE POLICY "Public read approved flowers"
  ON public.public_flowers
  FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

-- Public can read installation settings
CREATE POLICY "Public read installation settings"
  ON public.installation_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated Admin has full access to all tables
CREATE POLICY "Admin full access submissions"
  ON public.submissions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admin full access public_flowers"
  ON public.public_flowers
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admin full access settings"
  ON public.installation_settings
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 4. Server-Side Atomic Submission Function (RPC)
CREATE OR REPLACE FUNCTION public.submit_flower(
  p_display_name TEXT,
  p_message TEXT,
  p_design JSONB,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_settings RECORD;
  v_slot_index INTEGER;
  v_seed BIGINT;
  v_code TEXT;
  v_sub_id UUID;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_status TEXT;
  v_spacing NUMERIC := 2.4;
  v_golden_angle NUMERIC := 2.39996323;
  v_r NUMERIC;
  v_theta NUMERIC;
  v_x NUMERIC;
  v_z NUMERIC;
  v_y NUMERIC;
  v_placement JSONB;
  v_result JSONB;
BEGIN
  -- Check settings
  SELECT * INTO v_settings FROM public.installation_settings WHERE id = 1;
  IF v_settings.submissions_paused THEN
    RAISE EXCEPTION 'Submissions are currently paused';
  END IF;

  -- Validate lengths
  IF length(trim(p_message)) = 0 THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  -- Check existing idempotency
  SELECT id INTO v_sub_id FROM public.submissions WHERE idempotency_key = p_idempotency_key;
  IF v_sub_id IS NOT NULL THEN
    SELECT row_to_json(p)::jsonb INTO v_result FROM public.public_flowers p WHERE id = v_sub_id;
    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;
  END IF;

  -- Determine next atomic slot
  SELECT COALESCE(MAX(slot_index) + 1, 0) INTO v_slot_index FROM public.submissions;
  v_seed := floor(random() * 900000 + 100000)::bigint;

  -- Compute deterministic placement matching client terrain formula
  v_r := v_spacing * sqrt(v_slot_index + 1.2);
  v_theta := (v_slot_index + 1) * v_golden_angle;
  v_x := round(cos(v_theta) * v_r, 2);
  v_z := round(sin(v_theta) * v_r, 2);
  -- Center terrain height formula
  v_y := round((sin(v_x * 0.05 + 0.3) * cos(v_z * 0.05 - 0.2) * 2.2 + sin(v_x * 0.12 - 0.7) * sin(v_z * 0.14 + 0.5) * 1.0) * (1.0 - exp(-sqrt(v_x*v_x + v_z*v_z)*0.04)), 2);

  v_placement := jsonb_build_object(
    'x', v_x,
    'y', v_y,
    'z', v_z,
    'rotationY', round((random() * 6.28)::numeric, 2),
    'scale', round((0.9 + random() * 0.2)::numeric, 2),
    'slotIndex', v_slot_index
  );

  v_code := 'FLW-' || upper(substr(md5(random()::text), 1, 4));

  IF v_settings.approve_before_planting THEN
    v_status := 'pending';
  ELSE
    v_status := 'approved';
  END IF;

  -- Insert into private submissions
  INSERT INTO public.submissions (
    idempotency_key,
    display_name,
    message,
    design,
    seed,
    slot_index,
    placement,
    status,
    created_at,
    published_at
  ) VALUES (
    p_idempotency_key,
    COALESCE(nullif(trim(p_display_name), ''), 'A visitor'),
    trim(p_message),
    p_design,
    v_seed,
    v_slot_index,
    v_placement,
    v_status,
    v_now,
    CASE WHEN v_status = 'approved' THEN v_now ELSE NULL END
  ) RETURNING id INTO v_sub_id;

  -- If approved, publish to public projection
  IF v_status = 'approved' THEN
    INSERT INTO public.public_flowers (
      id,
      code,
      display_name,
      message,
      design,
      seed,
      slot_index,
      placement,
      status,
      created_at,
      published_at
    ) VALUES (
      v_sub_id,
      v_code,
      COALESCE(nullif(trim(p_display_name), ''), 'A visitor'),
      trim(p_message),
      p_design,
      v_seed,
      v_slot_index,
      v_placement,
      'approved',
      v_now,
      v_now
    );

    SELECT row_to_json(p)::jsonb INTO v_result FROM public.public_flowers p WHERE id = v_sub_id;
    RETURN v_result;
  END IF;

  RETURN jsonb_build_object(
    'id', v_sub_id,
    'status', 'pending',
    'code', v_code
  );
END;
$$;

-- Enable Realtime publication on public_flowers
ALTER PUBLICATION supabase_realtime ADD TABLE public.public_flowers;

