"""Forward only the reviewed read-only public CA to an independent app verifier."""

SOURCE = '/opt/codexdentist-owned-mail/core-trust/gateway.cert.pem'
TARGET = '/run/codexdentist-mail-ca.pem'
SERVICE_SOURCE = '/opt/codexdentist-owned-signing/core-trust/provider-gateways.cert.pem'
SERVICE_TARGET = '/run/codexdentist-service-cas.pem'


def public_ca_arguments(current):
    environment = dict(value.split('=', 1) for value in current['Config']['Env'])
    value = environment.get('NODE_EXTRA_CA_CERTS')
    if not value: return []
    source = {TARGET: SOURCE, SERVICE_TARGET: SERVICE_SOURCE}.get(value)
    if source is None: raise ValueError('Review a new runtime CA explicitly before forwarding it')
    mounts = [row for row in current['Mounts'] if row['Destination'] == value]
    if len(mounts) != 1 or mounts[0]['Type'] != 'bind' or mounts[0]['Source'] != source or mounts[0]['RW']:
        raise ValueError('Exact read-only public gateway CA mount required')
    return ['--mount', 'type=bind,source=' + source + ',target=' + value + ',readonly']
