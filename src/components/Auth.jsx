import { useState } from 'react'
import { supabase } from '../supabaseClient.js'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    if (isSignUp) {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (signUpError) {
        setError(signUpError.message)
      } else {
        setMessage('Account created. Check your email to confirm, then sign in.')
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        setError(signInError.message)
      }
    }

    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/60 px-8 py-10 shadow-2xl shadow-black/40">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            MaxYield AI
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            {isSignUp ? 'Create your account' : 'Sign in to continue'}
          </p>
        </header>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="auth-email"
              className="text-xs font-medium uppercase tracking-wider text-zinc-400"
            >
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none transition focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="auth-password"
              className="text-xs font-medium uppercase tracking-wider text-zinc-400"
            >
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none transition focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
              {error}
            </p>
          )}

          {message && (
            <p className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-300">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded-lg bg-white py-3.5 text-sm font-bold tracking-wide text-zinc-950 transition hover:bg-zinc-200 active:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Please wait…' : isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            type="button"
            onClick={() => {
              setIsSignUp((prev) => !prev)
              setError('')
              setMessage('')
            }}
            className="font-medium text-zinc-300 transition hover:text-white"
          >
            {isSignUp ? 'Sign in' : 'Sign up'}
          </button>
        </p>
      </div>
    </div>
  )
}
