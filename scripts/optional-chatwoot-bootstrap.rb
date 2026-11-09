# Run with Rails runner inside the pinned, owned Chatwoot Community instance.
# Input/output files are root-private mounts; nothing is printed to stdout.
require 'json'
input = JSON.parse(File.read('/run/codexdentist-bootstrap.json'))
email = input.fetch('owner-email')
name = 'Codexdentist private conversations'
accounts = Account.where(name: name)
raise 'Ambiguous service account' if accounts.count > 1
account = accounts.first || Account.create!(name: name, locale: 'vi')
user = User.find_or_initialize_by(email: email)
if user.new_record?
  user.name = 'Codexdentist Owner'
  user.password = input.fetch('chatwoot-owner-password')
  user.password_confirmation = user.password
  user.skip_confirmation_notification!
  user.skip_confirmation!
  user.save!
end
# The upstream installer also grants the owned first administrator the installation
# role and clears its Redis onboarding flag. An Account API probe alone does not
# prove the first-run form is closed.
user.update!(type: 'SuperAdmin') unless user.type == 'SuperAdmin'
raise 'Unconfirmed installation administrator' unless user.confirmed?
::Redis::Alfred.delete(::Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)
AccountUser.find_or_create_by!(account: account, user: user) { |row| row.role = :administrator }
inboxes = account.inboxes.where(name: 'Codexdentist patient conversations')
raise 'Ambiguous API inbox' if inboxes.count > 1
inbox = inboxes.first
unless inbox
  channel = Channel::Api.create!(account: account)
  inbox = account.inboxes.create!(name: 'Codexdentist patient conversations', channel: channel,
    greeting_enabled: false, enable_auto_assignment: false)
end
raise 'Unsafe inbox' unless inbox.channel_type == 'Channel::Api' && inbox.greeting_enabled == false
raise 'Unexpected automation' unless account.automation_rules.count == 0
def integration_user(email, password, account, inbox)
  service = User.find_or_initialize_by(email: email)
  if service.new_record?
    service.name = 'Codexdentist integration'
    service.password = password
    service.password_confirmation = password
    service.skip_confirmation_notification!
    service.skip_confirmation!
    service.save!
  end
  raise 'Integration principal must not be installation administrator' if service.type == 'SuperAdmin'
  AccountUser.find_or_create_by!(account: account, user: service) { |row| row.role = :agent }
  raise 'Integration principal spans accounts' unless service.account_users.count == 1
  InboxMember.find_or_create_by!(inbox: inbox, user: service)
  service.access_token || service.create_access_token!
end
token = integration_user('service+conversations@codexdentist.com', input.fetch('chatwoot-api-password'), account, inbox)
path = '/bootstrap-output/chatwoot-config.json'
File.write(path, JSON.generate({ baseUrl: 'http://codexdentist-chatwoot:3000', publicBaseUrl: 'https://chat.codexdentist.com', apiToken: token.token,
  accountId: account.id.to_s, inboxId: inbox.id.to_s }))
File.chmod(0600, path)
qa_accounts = Account.where(name: 'Codexdentist synthetic acceptance')
raise 'Ambiguous QA account' if qa_accounts.count > 1
qa = qa_accounts.first || Account.create!(name: 'Codexdentist synthetic acceptance', locale: 'vi')
AccountUser.find_or_create_by!(account: qa, user: user) { |row| row.role = :administrator }
qa_inbox = qa.inboxes.find_by(name: 'Synthetic acceptance')
unless qa_inbox
  qa_inbox = qa.inboxes.create!(name: 'Synthetic acceptance', channel: Channel::Api.create!(account: qa),
    greeting_enabled: false, enable_auto_assignment: false)
end
qa_path = '/bootstrap-output/chatwoot-qa-config.json'
qa_token = integration_user('service+synthetic-acceptance@codexdentist.com', input.fetch('chatwoot-qa-api-password'), qa, qa_inbox)
File.write(qa_path, JSON.generate({ baseUrl: 'http://codexdentist-chatwoot:3000', publicBaseUrl: 'https://chat.codexdentist.com', apiToken: qa_token.token,
  accountId: qa.id.to_s, inboxId: qa_inbox.id.to_s }))
File.chmod(0600, qa_path)
