describe('Signin page', () => {
  before(function () {
    cy.fixture('users.json').as('users')
  })

  beforeEach(function () {
    const user = this.users.moderator

    cy.intercept('POST', Cypress.config().apiPath + '/auth/login').as('authLogin')

    cy.visit('/signin')
    cy.get('input#signinEmailInput').type(user.email)
    cy.get('input#signinPasswordInput').type(user.password)
  })

  it('signs in successfully', function () {
    cy.get('button#signinButton').click()
    cy.wait('@authLogin').its('response.statusCode').should('eq', 200)
    cy.location('pathname').should('eq', '/')
  })
})
