/** @jsx jsx */

import React from 'react'
import { connect } from 'react-redux'
import { doSignin, doFacebookSignin } from '../../actions'
import { Link, Redirect } from 'react-router-dom'
import { Heading, Box, Text, Button, jsx } from 'theme-ui'
import StaticLayout from './lander-layout'

import strings from '../../strings/strings'

@connect((state) => state.signin)
class SignIn extends React.Component {
  // eslint-disable-next-line node/handle-callback-err
  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true }
  }

  componentDidMount() {
    this.props.dispatch({ type: 'signin reset state' })
  }

  componentDidCatch(error, errorInfo) {
    console.log(error, errorInfo)
  }

  handleLoginClicked(e) {
    e.preventDefault()
    const attrs = {
      email: this.email.value,
      password: this.password.value
    }

    this.props.dispatch(doSignin(attrs))
  }

  facebookButtonClicked() {
    let dest = this.getDest()
    if (!dest.length) {
      dest = '/'
    }
    this.props.dispatch(doFacebookSignin(dest))
  }

  handleFacebookPasswordSubmit() {
    let dest = this.getDest()
    if (!dest.length) {
      dest = '/'
    }
    const optionalPassword = this.facebook_password.value
    this.props.dispatch(doFacebookSignin(dest, optionalPassword))
  }

  maybeErrorMessage() {
    let markup = ''
    if (this.props.error) {
      markup = <div>{strings(this.props.error.responseText)}</div>
    }
    return markup
  }

  drawLoginForm() {
    return (
      <Box>
        <form>
          <Box sx={{ my: [2] }}>
            <input
              sx={{
                fontFamily: 'body',
                fontSize: [2],
                width: '35em',
                borderRadius: 2,
                padding: [2],
                border: '1px solid',
                borderColor: 'mediumGray'
              }}
              id="signinEmailInput"
              ref={(c) => (this.email = c)}
              placeholder="email"
              type="email"
            />
          </Box>
          <Box sx={{ my: [2] }}>
            <input
              sx={{
                fontFamily: 'body',
                fontSize: [2],
                width: '35em',
                borderRadius: 2,
                padding: [2],
                border: '1px solid',
                borderColor: 'mediumGray'
              }}
              id="signinPasswordInput"
              ref={(c) => (this.password = c)}
              placeholder="password"
              type="password"
            />
          </Box>
          {this.maybeErrorMessage()}
          <Button
            sx={{ my: [2] }}
            id="signinButton"
            onClick={this.handleLoginClicked.bind(this)}>
            {this.props.pending ? 'Signing in...' : 'Sign In'}
          </Button>
          <Text sx={{ my: 4 }}>
            {'Forgot your password? '}
            <Link to={'/pwresetinit'}>Reset Password</Link>
          </Text>
        </form>
        <Box sx={{ my: 4 }}>
          <Text sx={{ my: 4 }}>
            {'No account? '}
            <Link to={'/createuser'}>Sign up</Link>
          </Text>
        </Box>
        <Box sx={{ my: 4 }}>
          <Button
            id="facebookSigninButton"
            onClick={this.facebookButtonClicked.bind(this)}>
            Sign in with Facebook
          </Button>
          <Text sx={{ my: 2 }}>
            If you click &apos;Sign in with Facebook&apos; and are not a pol.is
            user, you will be registered and you agree to the pol.is terms and
            privacy policy
          </Text>
        </Box>
      </Box>
    )
  }

  drawPasswordConnectFacebookForm() {
    return (
      <span>
        <p>
          {
            'A pol.is user already exists with the email address associated with this Facebook account.'
          }
        </p>
        <p>
          {
            'Please enter the password to your pol.is account to enable Facebook login.'
          }
        </p>
        <input
          ref={(c) => (this.facebook_password = c)}
          placeholder="polis password"
          type="password"
        />
        <button onClick={this.handleFacebookPasswordSubmit.bind(this)}>
          {'Connect Facebook Account'}
        </button>
      </span>
    )
  }

  render() {
    const { signInSuccessful, authed } = this.props

    if (signInSuccessful || authed) {
      return <Redirect to={'/'} />
    }

    return (
      <StaticLayout>
        <Heading as="h1" sx={{ my: [4, null, 5], fontSize: [6, null, 7] }}>
          Sign In
        </Heading>
        {this.props.facebookError !== 'polis_err_user_with_this_email_exists'
          ? this.drawLoginForm()
          : this.drawPasswordConnectFacebookForm()}{' '}
      </StaticLayout>
    )
  }
}

export default SignIn
